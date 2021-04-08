import * as babel from '@babel/types'
import * as es from 'estree'
import { isObject } from 'lodash'
import { TypeError } from '../errors/errors'
import {
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

const isFunctionType = (t: RuntimeType | RuntimeTypeReference): t is RuntimeFunctionType =>
  t.kind === 'function'
const isTypeReference = (t: RuntimeType | RuntimeTypeReference): t is RuntimeTypeReference =>
  t.kind === 'name'

export const typeOfFunction = (
  node: babel.FunctionDeclaration | babel.FunctionExpression | babel.ArrowFunctionExpression
): RuntimeFunctionType => {
  const returnType = convertToRuntimeType(
    (node.returnType as babel.TSTypeAnnotation).typeAnnotation
  )
  const paramTypes = node.params.map(id => {
    const type = (id as babel.Identifier).typeAnnotation as babel.TSTypeAnnotation
    return convertToRuntimeType(type.typeAnnotation)
  })
  // TODO: check that babel.Noop won't happen
  const typeParams =
    node.typeParameters && babel.isTSTypeParameterDeclaration(node.typeParameters)
      ? extractTypeNames(node.typeParameters.params)
      : []
  return { kind: 'function', typeParams, paramTypes, returnType }
}

const extractTypeNames = (params: babel.TSTypeParameter[]) => {
  return params.map(p => p.name)
}

const convertToRuntimeType = (t: babel.TSType): RuntimeType | RuntimeTypeReference => {
  switch (t.type) {
    case 'TSAnyKeyword':
      throw new Error('Any types are not supported in x-slang')
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

const isMatchingType = (t1: RuntimeType | RuntimeTypeReference, t2: RuntimeType): boolean => {
  // TODO: deal with 'any'
  if (!isFunctionType(t1) || !isFunctionType(t2)) {
    return t1.kind === t2.kind
  }
  // same number of type parameters
  if (t1.typeParams.length !== t2.typeParams.length) {
    return false
  }
  // each of the function params reference the "same" type parameter position OR they have the same type
  for (let i = 0; i < t1.paramTypes.length; i++) {
    const t1Parameter = t1.paramTypes[i]
    const t2Parameter = t2.paramTypes[i]
    if (!isMatchingTypeBasedOnTypeParams(t1Parameter, t2Parameter, t1.typeParams, t2.typeParams)) {
      return false
    } else if (!isMatchingType(t1Parameter, t2Parameter as RuntimeType)) {
      // TODO: ensure t2Parameter is not RuntimeTypeReference
      return false
    }
  }
  if (
    !isMatchingTypeBasedOnTypeParams(t1.returnType, t2.returnType, t1.typeParams, t2.typeParams) ||
    !isMatchingType(t1.returnType, t2.returnType as RuntimeType)
  ) {
    return false
  }
  return true
}

const isMatchingTypeBasedOnTypeParams = (
  t1: RuntimeType | RuntimeTypeReference,
  t2: RuntimeType | RuntimeTypeReference,
  t1TypeParams: TypeName[],
  t2TypeParams: TypeName[]
) => {
  if (isTypeReference(t1) && isTypeReference(t2)) {
    return (
      t1TypeParams.indexOf(t1.value) !== -1 &&
      t2TypeParams.indexOf(t2.value) !== -1 &&
      t1TypeParams.indexOf(t1.value) === t2TypeParams.indexOf(t2.value)
    )
  } else if (isTypeReference(t1) || isTypeReference(t2)) {
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

// Checks that a variable declaration has type annotations and that
// its initial value's type matches the declared type
export const checkVariableDeclaration = (
  node: babel.VariableDeclaration,
  id: babel.Identifier,
  init: TypedValue
) => {
  if (!id.typeAnnotation) {
    return new TypeError(node, ` for variable ${id.name}`, 'type annotation', 'none')
  } else if (id.typeAnnotation.type !== 'TSTypeAnnotation') {
    return new TypeError(node, '', 'TSTypeAnnotation', id.typeAnnotation.type) //invalid program
  } else if (!isMatchingType(convertToRuntimeType(id.typeAnnotation.typeAnnotation), init.type)) {
    return new TypeError(
      node,
      ` as type of ${id.name}`,
      rttToString(convertToRuntimeType(id.typeAnnotation.typeAnnotation)),
      rttToString(init.type)
    )
  } else {
    return undefined
  }
}

// Checks that a function has properly annotated parameter types and a return type
export const checkFunctionDeclaration = (
  node: babel.FunctionDeclaration | babel.FunctionExpression | babel.ArrowFunctionExpression
) => {
  // TODO: better toString() for arrow function errors
  const functionName = babel.isFunctionDeclaration(node)
    ? `function ${node.id!.name}`
    : babel.isArrowFunctionExpression(node)
    ? 'arrow function'
    : 'function expression'
  for (const id of node.params) {
    if (!(id as babel.Identifier).typeAnnotation) {
      return new TypeError(
        node,
        ` for parameter ${(id as babel.Identifier).name} in ${functionName}`,
        'type annotation',
        'none'
      )
    }
  }
  if (!node.returnType) {
    return new TypeError(node, ` for ${functionName}`, 'return type annotation', 'none')
  }
  return undefined
}

// Checks that the given value can be called, i.e. is a function
export const checkCallee = (node: babel.CallExpression, callee: TypedValue) => {
  if (!isObject(callee.type)) {
    return new TypeError(node, ` as callee`, 'function', callee.type)
  }
  return undefined
}

export const checkTypeOfArguments = (
  node: babel.CallExpression,
  functionType: RuntimeFunctionType,
  args: TypedValue[]
) => {
  const paramTypes = functionType.paramTypes
  const argTypes = args.map(typedValue => typedValue.type)
  for (let i = 0; i < paramTypes.length; i++) {
    if (!isMatchingType(paramTypes[i], argTypes[i])) {
      return new TypeError(
        node,
        ` as argument ${i}`,
        rttToString(paramTypes[i]),
        rttToString(argTypes[i])
      )
    }
  }
  return undefined
}

export const checkTypeOfReturnValue = (
  node: babel.CallExpression,
  functionType: RuntimeFunctionType,
  result: TypedValue
) => {
  if (!isMatchingType(functionType.returnType, result.type)) {
    return new TypeError(
      node,
      ' as return value',
      rttToString(functionType.returnType),
      rttToString(result.type)
    )
  }
  return undefined
}

// Utility functions

const rttToString = (t: RuntimeType | RuntimeTypeReference): string =>
  isFunctionType(t)
    ? `(${t.paramTypes.map(type => rttToString(type)).join(', ')}) => ${rttToString(t.returnType)}`
    : isTypeReference(t)
    ? `type '${t.value}'`
    : t.kind
