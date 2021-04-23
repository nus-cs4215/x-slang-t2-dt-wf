import * as babel from '@babel/types'
import * as es from 'estree'
import { cloneDeep } from 'lodash'
import { MissingTypeAnnotationError, TypeError, UndefinedTypeError } from '../errors/errors'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import {
  Environment,
  RuntimeAny,
  RuntimeBoolean,
  RuntimeFunctionType,
  RuntimeNumber,
  RuntimeString,
  RuntimeType,
  RuntimeTypeReference,
  RuntimeUndefined,
  TypedValue,
  TypeName,
  Value
} from '../types'

const LHS = ' on left hand side of operator'
const RHS = ' on right hand side of operator'

/**
 * A placeholder value to indicate that the type reference should not be replaced by an actual type
 * (e.g. when resolving nested function types).
 */
const REFERENCE_TO_TYPE_PARAMETER = Symbol('function type parameter')

export const runtimeBoolean: RuntimeBoolean = { kind: 'boolean' }
export const runtimeNumber: RuntimeNumber = { kind: 'number' }
export const runtimeString: RuntimeString = { kind: 'string' }
export const runtimeUndefined: RuntimeUndefined = { kind: 'undefined' }
export const runtimeAny: RuntimeAny = { kind: 'any' }

// We need to define our own typeof in order for null/array to display properly in error messages
export const typeOf = (v: Value): RuntimeType => {
  const typeOfV = typeof v
  if (
    typeOfV === 'string' ||
    typeOfV === 'number' ||
    typeOfV === 'boolean' ||
    typeOfV === 'undefined'
  ) {
    return { kind: typeOfV }
  } else {
    throw Error(`unknown type in rttc.typeOf(${v}): ${typeOfV}`)
  }
  // if (v === null) {
  //   return 'null'
  // } else if (Array.isArray(v)) {
  //   return 'array'
  // } else {
  //   return typeof v
  // }
}

const isNumber = (v: TypedValue) => v.type.kind === 'number'
// See section 4 of https://2ality.com/2012/12/arrays.html
// v >>> 0 === v checks that v is a valid unsigned 32-bit int
// tslint:disable-next-line:no-bitwise
// const isArrayIndex = (v: Value) => isNumber(v) && v >>> 0 === v && v < 2 ** 32 - 1
const isString = (v: TypedValue) => v.type.kind === 'string'
const isBool = (v: TypedValue) => v.type.kind === 'boolean'
// const isObject = (v: Value) => typeOf(v) === 'object'
// const isArray = (v: Value) => typeOf(v) === 'array'

const isRuntimeFunctionType = (
  t: RuntimeType | RuntimeTypeReference | RuntimeAny
): t is RuntimeFunctionType => t.kind === 'function'
const isRuntimeTypeReference = (
  t: RuntimeType | RuntimeTypeReference | RuntimeAny
): t is RuntimeTypeReference => t.kind === 'name'
const isRuntimeAny = (t: RuntimeType | RuntimeTypeReference | RuntimeAny): t is RuntimeAny =>
  t.kind === 'any'

const extractTypeNames = (params: babel.TSTypeParameter[]) => params.map(p => p.name)

export const convertToRuntimeType = (
  t: babel.TSType
): RuntimeType | RuntimeTypeReference | RuntimeAny => {
  switch (t.type) {
    case 'TSAnyKeyword':
      // throw new Error('Any types are not supported in x-slang')
      return runtimeAny
    case 'TSBigIntKeyword':
      throw new Error('BigInts are not supported in x-slang')
    case 'TSBooleanKeyword':
      return runtimeBoolean
    case 'TSIntrinsicKeyword':
      throw new Error('TS Intrinsic Keywords are not supported in x-slang')
    case 'TSLiteralType':
      throw new Error('TS Literal Types are not supported in x-slang')
    case 'TSNeverKeyword':
      throw new Error('TS Never Keywords are not supported in x-slang')
    case 'TSNullKeyword':
      throw new Error('TS Null keywords are not supported in x-slang')
    case 'TSNumberKeyword':
      return runtimeNumber
    case 'TSObjectKeyword':
      throw new Error('TS Object Keywords are not supported in x-slang')
    case 'TSStringKeyword':
      return runtimeString
    case 'TSSymbolKeyword':
      throw new Error('TS Symbol Keywords are not supported in x-slang')
    case 'TSThisType':
      throw new Error('TS This Types are not supported in x-slang')
    case 'TSUndefinedKeyword':
      throw new Error('TS Undefined Keywords are not supported in x-slang')
    case 'TSVoidKeyword':
      throw new Error('TS Void Keywords are not supported in x-slang') // TODO: when adding functions
    case 'TSFunctionType':
      if (!t.typeAnnotation) {
        throw new Error(
          `TS type annotations are required for function return types (line ${t.loc?.start.line} column ${t.loc?.start.column})`
        )
      }
      // TODO: ensure no infinite loop

      return {
        kind: 'function',
        typeParams: t.typeParameters ? extractTypeNames(t.typeParameters.params) : [],
        paramTypes: t.parameters.map(id => {
          if (!id.typeAnnotation || !babel.isTSTypeAnnotation(id.typeAnnotation)) {
            throw new Error(
              `TS type annotations are required in function type parameters (line ${id.loc?.start.line} column ${id.loc?.start.column})`
            )
          }
          return convertToRuntimeType(id.typeAnnotation.typeAnnotation)
        }),
        returnType: convertToRuntimeType(t.typeAnnotation.typeAnnotation)
      }
    case 'TSTypeReference':
      if (!babel.isIdentifier(t.typeName)) {
        throw new Error('TSQualifiedName is not supported.')
      }
      return { kind: 'name', value: t.typeName.name }
    default:
      // TSConstructorType | TSTypePredicate | TSTypeQuery | TSTypeLiteral | TSArrayType | TSTupleType | TSOptionalType | TSRestType | TSUnionType | TSIntersectionType | TSConditionalType | TSInferType | TSParenthesizedType | TSTypeOperator | TSIndexedAccessType | TSMappedType | TSExpressionWithTypeArguments | TSImportType
      throw new Error(`Unknown type in convertToRuntimeType: ${t.type}`)
  }
}

const areTypesEqual = (
  t1: RuntimeType | RuntimeTypeReference | RuntimeAny,
  t2: RuntimeType | RuntimeAny,
  t1TypeEnv: TypeName[][] = [],
  t2TypeEnv: TypeName[][] = []
): boolean => {
  if (isRuntimeAny(t1) || isRuntimeAny(t2)) {
    return true // 'any' types are always considered equal
  }
  if (!isRuntimeFunctionType(t1) || !isRuntimeFunctionType(t2)) {
    return t1.kind === t2.kind
  }
  // same number of type parameters
  if (t1.typeParams.length !== t2.typeParams.length) {
    return false
  }
  const newT1TypeEnv = [t1.typeParams, ...t1TypeEnv]
  const newT2TypeEnv = [t2.typeParams, ...t2TypeEnv]
  // each of the function params reference the "same" type parameter position OR they have the same type
  for (let i = 0; i < t1.paramTypes.length; i++) {
    const t1Parameter = t1.paramTypes[i]
    const t2Parameter = t2.paramTypes[i]
    if (
      !areTypeReferencesEqual(t1Parameter, t2Parameter, newT1TypeEnv, newT2TypeEnv) ||
      !areTypesEqual(t1Parameter, t2Parameter as RuntimeType, newT1TypeEnv, newT2TypeEnv)
    ) {
      // TODO: ensure t2Parameter is not RuntimeTypeReference
      return false
    }
  }
  if (
    !areTypeReferencesEqual(t1.returnType, t2.returnType, newT1TypeEnv, newT2TypeEnv) ||
    !areTypesEqual(t1.returnType, t2.returnType as RuntimeType, newT1TypeEnv, newT2TypeEnv)
  ) {
    return false
  }
  return true
}

/**
 * Returns false if one of the two types is not a type reference
 * or if both are type references but have different positions in the typeParams 2D array.
 * Returns true otherwise.
 */
const areTypeReferencesEqual = (
  t1: RuntimeType | RuntimeTypeReference | RuntimeAny,
  t2: RuntimeType | RuntimeTypeReference | RuntimeAny,
  t1TypeParams: TypeName[][],
  t2TypeParams: TypeName[][]
) => {
  if (isRuntimeTypeReference(t1) && isRuntimeTypeReference(t2)) {
    for (let i = 0; i < t1TypeParams.length; i++) {
      const hasFoundT1 = t1TypeParams[i].indexOf(t1.value) !== -1
      const hasFoundT2 = t2TypeParams[i].indexOf(t2.value) !== -1
      if (hasFoundT1 && hasFoundT2) {
        // Both found in current "environment frame"
        return t1TypeParams[i].indexOf(t1.value) === t2TypeParams[i].indexOf(t2.value)
      } else if (hasFoundT1 || hasFoundT2) {
        // Only one found in current "environment frame"
        return false
      }
    }
  } else if (isRuntimeTypeReference(t1) || isRuntimeTypeReference(t2)) {
    return false
  }
  return true
}

export const checkUnaryExpression = (
  node: es.Node,
  operator: es.UnaryOperator,
  value: TypedValue
) => {
  if ((operator === '+' || operator === '-') && !isNumber(value)) {
    return new TypeError(node, '', 'number', rttToString(value.type))
  } else if (operator === '!' && !isBool(value)) {
    return new TypeError(node, '', 'boolean', rttToString(value.type))
  } else {
    return undefined
  }
}

export const checkBinaryExpression = (
  node: es.Node,
  operator: es.BinaryOperator,
  left: TypedValue,
  right: TypedValue
) => {
  switch (operator) {
    case '-':
    case '*':
    case '/':
    case '%':
      if (!isNumber(left)) {
        return new TypeError(node, `${LHS} ${operator}`, 'number', rttToString(left.type))
      } else if (!isNumber(right)) {
        return new TypeError(node, `${RHS} ${operator}`, 'number', rttToString(right.type))
      } else {
        return
      }
    case '+':
    case '<':
    case '<=':
    case '>':
    case '>=':
    case '!==':
    case '===':
      if (isNumber(left)) {
        return isNumber(right)
          ? undefined
          : new TypeError(node, `${RHS} ${operator}`, 'number', rttToString(right.type))
      } else if (isString(left)) {
        return isString(right)
          ? undefined
          : new TypeError(node, `${RHS} ${operator}`, 'string', rttToString(right.type))
      } else {
        return new TypeError(node, `${LHS} ${operator}`, 'string or number', rttToString(left.type))
      }
    default:
      return
  }
}

export const checkIfStatement = (node: es.Node, test: TypedValue) => {
  return isBool(test)
    ? undefined
    : new TypeError(node, ' as condition', 'boolean', rttToString(test.type))
}

// export const checkMemberAccess = (node: es.Node, obj: Value, prop: Value) => {
//   if (isObject(obj)) {
//     return isString(prop) ? undefined : new TypeError(node, ' as prop', 'string', typeOf(prop))
//   } else if (isArray(obj)) {
//     return isArrayIndex(prop)
//       ? undefined
//       : isNumber(prop)
//       ? new TypeError(node, ' as prop', 'array index', 'other number')
//       : new TypeError(node, ' as prop', 'array index', typeOf(prop))
//   } else {
//     return new TypeError(node, '', 'object or array', typeOf(obj))
//   }
// }

const stringifyArrowFunctionExpression = (node: babel.ArrowFunctionExpression) =>
  (node.params.length === 1 ? '' : '(') +
  node.params.map((o: babel.Identifier) => o.name).join(', ') +
  (node.params.length === 1 ? '' : ')') +
  ' => ...'

const stringifyTSFunctionType = (node: babel.TSFunctionType) =>
  (node.parameters.length === 1 ? '' : '(') +
  node.parameters.map((o: babel.Identifier) => o.name).join(', ') +
  (node.parameters.length === 1 ? '' : ')') +
  ' => ...'

function lookupType(env: Environment, name: string, node: babel.Node) {
  let environment: Environment = env
  while (true) {
    if (environment.head.types.hasOwnProperty(name)) {
      const result = environment.head.types[name]
      // if (result === DECLARED_BUT_NOT_YET_ASSIGNED) {
      //   return handleRuntimeError(context, new errors.UnassignedVariable(name, node))
      // }
      return result
    }
    if (environment.tail === null) {
      return new UndefinedTypeError(name, node)
    }
    environment = environment.tail
  }
}

/**
 * Checks that there are no references to undefined types,
 * and that all function types have the necessary type annotations.
 */
const checkTSTypeValid = (
  typeAnnotation: babel.TSType,
  typeParameters: Set<string>,
  env: Environment
): RuntimeSourceError | undefined => {
  if (babel.isTSTypeReference(typeAnnotation)) {
    if (babel.isTSQualifiedName(typeAnnotation.typeName)) {
      throw new Error('Unknown TS Qualified Name')
    }
    if (!typeParameters.has(typeAnnotation.typeName.name)) {
      const errorOrType = lookupType(env, typeAnnotation.typeName.name, typeAnnotation)
      if (errorOrType instanceof UndefinedTypeError) {
        return errorOrType // error
      }
    }
  } else if (babel.isTSFunctionType(typeAnnotation)) {
    const error = checkFunctionTypeValid(typeAnnotation, typeParameters, env)
    if (error) return error
  }
  return undefined
}

/**
 * Checks that all type references in the given function type are valid.
 * A valid type reference exists in the set of type parameters or the environment.
 */
const checkFunctionTypeValid = (
  node: babel.TSFunctionType,
  typeParams: Set<string>,
  env: Environment
): RuntimeSourceError | undefined => {
  const functionName = stringifyTSFunctionType(node)

  const typeParameters = new Set(typeParams)
  if (node.typeParameters) {
    const params = (node.typeParameters as babel.TSTypeParameterDeclaration).params
    for (let i = 0; i < params.length; i++) {
      typeParameters.add(params[i].name)
    }
  }
  for (const id of node.parameters) {
    const identifier = id as babel.Identifier
    if (!identifier.typeAnnotation) {
      return new MissingTypeAnnotationError(
        node,
        `Parameter ${identifier.name} in function type ${functionName}`
      )
    }
    const typeAnnotation = (identifier.typeAnnotation as babel.TSTypeAnnotation).typeAnnotation
    const error = checkTSTypeValid(typeAnnotation, typeParameters, env)
    if (error) {
      return error
    }
  }

  if (!node.typeAnnotation) {
    return new MissingTypeAnnotationError(node, `The return type for function type ${functionName}`)
  }
  const typeAnnotation = (node.typeAnnotation as babel.TSTypeAnnotation).typeAnnotation
  const error = checkTSTypeValid(typeAnnotation, typeParameters, env)
  if (error) {
    return error
  }

  return undefined
}

/**
 * Returns the runtime function type for the given node, with type references
 * resolved to their actual types in the given environment.
 * Assumes that the validity of type references has already been checked before this.
 */
export const typeOfFunction = (
  node: babel.FunctionDeclaration | babel.FunctionExpression | babel.ArrowFunctionExpression,
  env: Environment
): RuntimeFunctionType => {
  // TODO: check that babel.Noop won't happen

  // construct temporary type env
  const typeParams =
    node.typeParameters && babel.isTSTypeParameterDeclaration(node.typeParameters)
      ? extractTypeNames(node.typeParameters.params)
      : []
  const typeEnv = {}
  typeParams.forEach(paramName => (typeEnv[paramName] = REFERENCE_TO_TYPE_PARAMETER))

  // resolve param and return types
  const paramTypes = node.params.map(id => {
    const type = (id as babel.Identifier).typeAnnotation as babel.TSTypeAnnotation
    const rtt = convertToRuntimeType(type.typeAnnotation)
    return resolveToActualType(rtt, typeEnv, env, node) as RuntimeType // if error, should have been thrown in `checkFunctionDeclaration`
  })
  const returnRTT = convertToRuntimeType((node.returnType as babel.TSTypeAnnotation).typeAnnotation)
  const returnType = resolveToActualType(returnRTT, typeEnv, env, node) as RuntimeType // if error, should have been thrown in `checkFunctionDeclaration`
  return { kind: 'function', typeParams, paramTypes, returnType }
}

/**
 * Replaces all type references in the given type based on
 * the given (temporary) type environment and the actual (type) environment,
 * and returns the resolved type.
 *
 * For example, for `<S>(x: S): T`, the type reference `T`
 * should be replaced by the value of `T` in `typeEnv` if such a name binding exists.
 * Otherwise, we look up the value of `T` in `env`.
 * If `T` = `number`, the runtime type `<S>(x: S): number` should be returned.
 *
 * A type reference may be returned for intermediate recursive calls.
 * TODO: make a separate function that's not allowed to return RTTypeReference
 *
 * @param node is only needed to throw errors if type lookup fails.
 */
const resolveToActualType = (
  type: RuntimeType | RuntimeTypeReference | RuntimeAny,
  typeEnv: Record<string, RuntimeType | typeof REFERENCE_TO_TYPE_PARAMETER>,
  env: Environment,
  node: babel.Node
): RuntimeType | RuntimeTypeReference | RuntimeAny | UndefinedTypeError => {
  if (isRuntimeAny(type)) {
    return type
  }
  let resolvedType = cloneDeep(type)
  if (isRuntimeTypeReference(resolvedType)) {
    const typeName = resolvedType.value
    if (typeEnv[typeName] !== undefined) {
      // Has type argument
      if (typeEnv[typeName] === REFERENCE_TO_TYPE_PARAMETER) {
        return resolvedType
      }
      resolvedType = typeEnv[typeName] as RuntimeType
    } else {
      // Needs to be looked up
      const typeInCurrentEnvOrError = lookupType(env, typeName, node)
      if (typeInCurrentEnvOrError instanceof UndefinedTypeError) {
        console.log(`error!! ${JSON.stringify(type)}`)
        console.log(typeInCurrentEnvOrError)
        console.log(typeEnv)
        return typeInCurrentEnvOrError
      }
      resolvedType = typeInCurrentEnvOrError
    }
  }
  // The referenced type may be a function, in which case it also needs to be resolved.
  // (Hence, `if` and not `else if`.)
  if (isRuntimeFunctionType(resolvedType)) {
    const newTypeEnv = { ...typeEnv }
    resolvedType.typeParams.forEach(param => (newTypeEnv[param] = REFERENCE_TO_TYPE_PARAMETER))
    for (let i = 0; i < resolvedType.paramTypes.length; i++) {
      // Use a for loop to terminate once error is found
      const resolvedParamType = resolveToActualType(
        resolvedType.paramTypes[i],
        newTypeEnv,
        env,
        node
      )
      if (resolvedParamType instanceof UndefinedTypeError) {
        return resolvedParamType
      }
      resolvedType.paramTypes[i] = resolvedParamType
    }
    const resolvedReturnType = resolveToActualType(resolvedType.returnType, newTypeEnv, env, node)
    if (resolvedReturnType instanceof UndefinedTypeError) {
      return resolvedReturnType
    }
    resolvedType.returnType = resolvedReturnType
  }
  // In all other cases the type is already a base type
  return resolvedType
}

/**
 * Checks that a variable's initial value's type matches the declared type,
 * if a type annotation is present.
 *
 * NOTE: When implementing variable assignment, use the initial value's type
 * as the variable's type.
 */
export const checkVariableDeclaration = (
  node: babel.VariableDeclaration,
  id: babel.Identifier,
  init: TypedValue,
  env: Environment
) => {
  if (id.typeAnnotation) {
    if (!babel.isTSTypeAnnotation(id.typeAnnotation)) {
      return new TypeError(node, '', 'TSTypeAnnotation', id.typeAnnotation.type) //invalid TypeScript program
    }
    const typeAnnotation = id.typeAnnotation.typeAnnotation
    // if (babel.isAnyTypeAnnotation(typeAnnotation)) {
    //   return undefined
    // }
    const error = checkTSTypeValid(typeAnnotation, new Set(), env)
    if (error) {
      return error
    }
    const rttOrTypeName = convertToRuntimeType(typeAnnotation)
    const expectedVariableType = resolveToActualType(rttOrTypeName, {}, env, node) as RuntimeType // undefined type references would have been caught by `checkTSTypeValid`
    if (!areTypesEqual(expectedVariableType, init.type)) {
      return new TypeError(
        node,
        ` as type of ${id.name}`,
        rttToString(expectedVariableType),
        rttToString(init.type)
      )
    }
  }
  return undefined
}

/**
 * Checks that a function has properly annotated parameter types and a return type,
 * and that all type references are valid.
 */
export const checkFunctionDeclaration = (
  node: babel.FunctionDeclaration | babel.FunctionExpression | babel.ArrowFunctionExpression,
  env: Environment
) => {
  const functionName = babel.isFunctionDeclaration(node)
    ? `function ${node.id!.name}`
    : babel.isArrowFunctionExpression(node)
    ? stringifyArrowFunctionExpression(node)
    : 'function expression'

  // Check presence of type annotations
  for (const id of node.params) {
    const identifier = id as babel.Identifier
    if (!identifier.typeAnnotation) {
      return new TypeError(
        node,
        ` for parameter ${identifier.name} in ${functionName}`,
        'type annotation',
        'none'
      )
    }
  }
  if (!node.returnType) {
    return new TypeError(node, ` for ${functionName}`, 'return type annotation', 'none')
  }

  // Check validity of type annotations
  const typeParameters: Set<string> = new Set()
  if (node.typeParameters) {
    const params = (node.typeParameters as babel.TSTypeParameterDeclaration).params
    for (let i = 0; i < params.length; i++) {
      typeParameters.add(params[i].name)
    }
  }
  for (const id of node.params) {
    const typeAnnotation = ((id as babel.Identifier).typeAnnotation as babel.TSTypeAnnotation)
      .typeAnnotation
    const error = checkTSTypeValid(typeAnnotation, typeParameters, env)
    if (error) {
      return error
    }
  }
  const typeAnnotation = (node.returnType as babel.TSTypeAnnotation).typeAnnotation
  const error = checkTSTypeValid(typeAnnotation, typeParameters, env)
  if (error) {
    return error
  }

  return undefined
}

// Checks that the given value can be called, i.e. is a function
export const checkCallee = (node: babel.CallExpression, callee: TypedValue) => {
  if (!isRuntimeFunctionType(callee.type)) {
    return new TypeError(node, ` as callee`, 'function', callee.type.kind)
  }
  return undefined
}

export const getTypeArgs = (node: babel.TSTypeParameterInstantiation | null, env: Environment) => {
  if (!node) {
    return []
  }
  const typeArgs = node.params.map(type => {
    const rtt = convertToRuntimeType(type)
    return isRuntimeTypeReference(rtt) ? lookupType(env, rtt.value, node) : rtt
  })
  for (const typeArgOrError of typeArgs) {
    if (typeArgOrError instanceof UndefinedTypeError) {
      return typeArgOrError // error
    }
  }
  return typeArgs as RuntimeType[]
}

export const checkTypeOfArguments = (
  node: babel.CallExpression,
  functionType: RuntimeFunctionType,
  args: TypedValue[],
  typeArgs: RuntimeType[],
  env: Environment
) => {
  const typeEnv: Record<string, RuntimeType> = {}
  for (let i = 0; i < functionType.typeParams.length; i++) {
    const typeParamName = functionType.typeParams[i]
    typeEnv[typeParamName] = typeArgs[i]
  }

  // resolve expected types
  const expectedParamTypes = [...functionType.paramTypes] // clone the array
  for (let i = 0; i < expectedParamTypes.length; i++) {
    const resolvedParamType = resolveToActualType(expectedParamTypes[i], typeEnv, env, node)
    if (resolvedParamType instanceof UndefinedTypeError) {
      // NOTE: should not happen since it's already checked during function declaration
      return resolvedParamType
    }
    expectedParamTypes[i] = resolvedParamType
  }

  // then check that they match
  const paramTypes = functionType.paramTypes
  const argTypes = args.map(typedValue => typedValue.type)
  for (let i = 0; i < paramTypes.length; i++) {
    if (!areTypesEqual(expectedParamTypes[i], argTypes[i])) {
      // if (!isRuntimeAny(expectedParamType) && !isMatchingType(expectedParamType, argTypes[i])) {
      return new TypeError(
        node,
        ` as argument ${i}`,
        rttToString(expectedParamTypes[i]),
        rttToString(argTypes[i])
      )
    }
  }
  return undefined
}

export const checkTypeOfReturnValue = (
  node: babel.CallExpression,
  functionType: RuntimeFunctionType,
  result: TypedValue,
  env: Environment
) => {
  const expectedReturnType = resolveToActualType(functionType.returnType, {}, env, node)
  if (expectedReturnType instanceof UndefinedTypeError) {
    return expectedReturnType
  }
  const actualReturnType = resolveToActualType(result.type, {}, env, node)
  if (actualReturnType instanceof UndefinedTypeError) {
    return actualReturnType
  } else if (actualReturnType.kind === 'name') {
    throw Error() // TODO: ensure this can't happen
  }
  if (!areTypesEqual(expectedReturnType, actualReturnType)) {
    // if (!isRuntimeAny(expectedReturnType) && !isMatchingType(expectedReturnType, result.type)) {
    return new TypeError(
      node,
      ' as return value',
      rttToString(expectedReturnType),
      rttToString(actualReturnType)
    )
  }
  return undefined
}

// Utility functions

const rttToString = (t: RuntimeType | RuntimeTypeReference | RuntimeAny): string =>
  isRuntimeFunctionType(t)
    ? `${
        t.typeParams.length === 0
          ? ''
          : `<${t.typeParams.reduce((prev, curr) => prev + curr + ', ', '').slice(undefined, -2)}>`
      }(${t.paramTypes.map(type => rttToString(type)).join(', ')}) => ${rttToString(t.returnType)}`
    : isRuntimeTypeReference(t)
    ? `type '${t.value}'`
    : t.kind
