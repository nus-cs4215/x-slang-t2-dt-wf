import * as babel from '@babel/types'
import * as es from 'estree'
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

const LHS = ' on left hand side of operation'
const RHS = ' on right hand side of operation'

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
// const isRuntimeAny = (t: RuntimeType | RuntimeTypeReference | RuntimeAny): t is RuntimeAny =>
//   t.kind === 'any'

const extractTypeNames = (params: babel.TSTypeParameter[]) => params.map(p => p.name)

export const convertToRuntimeType = (t: babel.TSType): RuntimeType | RuntimeTypeReference => {
  switch (t.type) {
    case 'TSAnyKeyword':
      throw new Error('Any types are not supported in x-slang')
    // return runtimeAny
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
      return runtimeUndefined
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

const isMatchingType = (
  t1: RuntimeType | RuntimeTypeReference,
  t2: RuntimeType,
  t1TypeEnv: TypeName[][] = [],
  t2TypeEnv: TypeName[][] = []
): boolean => {
  // TODO: deal with 'any'
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
    // if (isRuntimeAny(t1Parameter) || isRuntimeAny(t2Parameter)) {
    //   continue // if either parameter is 'any', no need to check
    // }
    if (
      !isMatchingTypeReference(t1Parameter, t2Parameter, newT1TypeEnv, newT2TypeEnv) ||
      !isMatchingType(t1Parameter, t2Parameter as RuntimeType, newT1TypeEnv, newT2TypeEnv)
    ) {
      // TODO: ensure t2Parameter is not RuntimeTypeReference
      return false
    }
  }
  // if (isRuntimeAny(t1.returnType) || isRuntimeAny(t2.returnType)) {
  //   return true
  // } else
  if (
    !isMatchingTypeReference(t1.returnType, t2.returnType, newT1TypeEnv, newT2TypeEnv) ||
    !isMatchingType(t1.returnType, t2.returnType as RuntimeType, newT1TypeEnv, newT2TypeEnv)
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
const isMatchingTypeReference = (
  t1: RuntimeType | RuntimeTypeReference,
  t2: RuntimeType | RuntimeTypeReference,
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
        return new TypeError(node, LHS, 'number', rttToString(left.type))
      } else if (!isNumber(right)) {
        return new TypeError(node, RHS, 'number', rttToString(right.type))
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
          : new TypeError(node, RHS, 'number', rttToString(right.type))
      } else if (isString(left)) {
        return isString(right)
          ? undefined
          : new TypeError(node, RHS, 'string', rttToString(right.type))
      } else {
        return new TypeError(node, LHS, 'string or number', rttToString(left.type))
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

// TODO: decide which node to accept
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
    const variableType = (isRuntimeTypeReference(rttOrTypeName)
      ? lookupType(env, rttOrTypeName.value, node)
      : rttOrTypeName) as RuntimeType // undefined type references would have been caught by `checkTSTypeValid`
    if (!isMatchingType(variableType, init.type)) {
      return new TypeError(
        node,
        ` as type of ${id.name}`,
        rttToString(variableType),
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
  const typeParameters: Set<string> = new Set()
  if (node.typeParameters) {
    const params = (node.typeParameters as babel.TSTypeParameterDeclaration).params
    for (let i = 0; i < params.length; i++) {
      typeParameters.add(params[i].name)
    }
  }
  const functionName = babel.isFunctionDeclaration(node)
    ? `function ${node.id!.name}`
    : babel.isArrowFunctionExpression(node)
    ? stringifyArrowFunctionExpression(node)
    : 'function expression'
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
    const typeAnnotation = (identifier.typeAnnotation as babel.TSTypeAnnotation).typeAnnotation
    const error = checkTSTypeValid(typeAnnotation, typeParameters, env)
    if (error) {
      return error
    }
  }
  if (!node.returnType) {
    return new TypeError(node, ` for ${functionName}`, 'return type annotation', 'none')
  }
  const typeAnnotation = (node.returnType as babel.TSTypeAnnotation).typeAnnotation
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
  const typeParams =
    node.typeParameters && babel.isTSTypeParameterDeclaration(node.typeParameters)
      ? extractTypeNames(node.typeParameters.params)
      : []
  const paramTypes = node.params.map(id => {
    const type = (id as babel.Identifier).typeAnnotation as babel.TSTypeAnnotation
    const rtt = convertToRuntimeType(type.typeAnnotation)
    return (isRuntimeTypeReference(rtt) && !typeParams.includes(rtt.value)
      ? lookupType(env, rtt.value, node)
      : rtt) as RuntimeType
  })
  const returnRTT = convertToRuntimeType((node.returnType as babel.TSTypeAnnotation).typeAnnotation)
  const returnType = (isRuntimeTypeReference(returnRTT) && !typeParams.includes(returnRTT.value)
    ? lookupType(env, returnRTT.value, node)
    : returnRTT) as RuntimeType // if error, should have been thrown in `checkFunctionDeclaration`
  return { kind: 'function', typeParams, paramTypes, returnType }
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
      // TODO: better way to pass error value
      return typeArgOrError // error
    }
  }
  return typeArgs as RuntimeType[]
}

/**
 * Replaces any type references in the function parameter/return types
 * with their actual types in the current environment.
 *
 * TODO: nested function types
 */
const resolveFunctionType = (
  expectedType: RuntimeFunctionType,
  node: babel.Node,
  env: Environment,
  typeEnv?: Record<string, RuntimeType>
): RuntimeFunctionType | UndefinedTypeError => {
  const expectedTypeClone = { ...expectedType, paramTypes: [...expectedType.paramTypes] }
  const { typeParams, paramTypes, returnType } = expectedTypeClone
  for (let i = 0; i < paramTypes.length; i++) {
    const param = paramTypes[i]
    if (isRuntimeTypeReference(param)) {
      if (typeParams.includes(param.value)) {
        // don't need to change anything
      } else if (typeEnv && typeEnv.hasOwnProperty(param.value)) {
        expectedTypeClone.paramTypes[i] = typeEnv[param.value]
      } else {
        const typeInCurrentEnvOrError = lookupType(env, param.value, node)
        if (typeInCurrentEnvOrError instanceof UndefinedTypeError) {
          // NOTE: should not happen, should be checked during function declaration instead
          return typeInCurrentEnvOrError
        }
        expectedTypeClone.paramTypes[i] = typeInCurrentEnvOrError
      }
    }
  }
  if (isRuntimeTypeReference(returnType)) {
    if (typeParams.includes(returnType.value)) {
      // don't need to change anything
    } else if (typeEnv && typeEnv.hasOwnProperty(returnType.value)) {
      expectedTypeClone.returnType = typeEnv[returnType.value]
    } else {
      const typeInCurrentEnvOrError = lookupType(env, returnType.value, node)
      if (typeInCurrentEnvOrError instanceof UndefinedTypeError) {
        // NOTE: should not happen, should be checked during function declaration instead
        return typeInCurrentEnvOrError
      }
      expectedTypeClone.returnType = typeInCurrentEnvOrError
    }
  }
  return expectedTypeClone
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
  const paramTypes = functionType.paramTypes
  const argTypes = args.map(typedValue => typedValue.type)
  for (let i = 0; i < paramTypes.length; i++) {
    let expectedParamType = paramTypes[i]
    // Deal with type references
    if (isRuntimeTypeReference(expectedParamType)) {
      const typeName = expectedParamType.value
      if (typeEnv[typeName] !== undefined) {
        // Check the potential new environment first
        expectedParamType = typeEnv[typeName]
      } else {
        const typeInCurrentEnvOrError = lookupType(env, typeName, node)
        if (typeInCurrentEnvOrError instanceof UndefinedTypeError) {
          // NOTE: should not happen since it's already checked during function declaration
          return typeInCurrentEnvOrError
        }
        expectedParamType = typeInCurrentEnvOrError
      }
    }
    if (isRuntimeFunctionType(expectedParamType)) {
      const typeOrError = resolveFunctionType(expectedParamType, node, env, typeEnv)
      if (typeOrError instanceof UndefinedTypeError) {
        return typeOrError
      }
      expectedParamType = typeOrError
    }
    if (!isMatchingType(expectedParamType, argTypes[i])) {
      // if (!isRuntimeAny(expectedParamType) && !isMatchingType(expectedParamType, argTypes[i])) {
      // TODO: follow TS error message
      return new TypeError(
        node,
        // TODO: name of parameter instead of index
        ` as argument ${i + 1}`,
        // TODO: stack trace so the substitution is clearer
        rttToString(expectedParamType),
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
  let expectedReturnType = functionType.returnType
  if (isRuntimeTypeReference(expectedReturnType)) {
    const typeName = expectedReturnType.value
    const typeInCurrentEnvOrError = lookupType(env, typeName, node)
    if (typeInCurrentEnvOrError instanceof UndefinedTypeError) {
      // NOTE: should not happen since it's already checked during function declaration
      return typeInCurrentEnvOrError
    }
    expectedReturnType = typeInCurrentEnvOrError
  }
  if (isRuntimeFunctionType(expectedReturnType)) {
    const typeOrError = resolveFunctionType(expectedReturnType, node, env)
    if (typeOrError instanceof UndefinedTypeError) {
      return typeOrError
    }
    expectedReturnType = typeOrError
  }
  if (!isMatchingType(expectedReturnType, result.type)) {
    // if (!isRuntimeAny(expectedReturnType) && !isMatchingType(expectedReturnType, result.type)) {
    return new TypeError(
      node,
      ' as return value',
      rttToString(expectedReturnType),
      rttToString(result.type)
    )
  }
  return undefined
}

// Utility functions

const rttToString = (t: RuntimeType | RuntimeTypeReference | RuntimeAny): string =>
  isRuntimeFunctionType(t)
    ? `(${t.paramTypes.map(type => rttToString(type)).join(', ')}) => ${rttToString(t.returnType)}`
    : isRuntimeTypeReference(t)
    ? `type '${t.value}'`
    : t.kind
