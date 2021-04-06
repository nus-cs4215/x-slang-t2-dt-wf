import * as babel from '@babel/types'
import * as es from 'estree'
import { isObject } from 'lodash'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import {
  ErrorSeverity,
  ErrorType,
  RuntimeFunctionType,
  RuntimeType,
  TypedValue,
  Value
} from '../types'

const LHS = ' on left hand side of operation'
const RHS = ' on right hand side of operation'

export class TypeError extends RuntimeSourceError {
  public type = ErrorType.RUNTIME
  public severity = ErrorSeverity.ERROR
  public location: es.SourceLocation

  constructor(
    node: es.Node | babel.Node,
    public side: string,
    public expected: string,
    public got: string
  ) {
    super(node)
  }

  public explain() {
    return `Expected ${this.expected}${this.side}, got ${this.got}.`
  }

  public elaborate() {
    return this.explain()
  }
}

// We need to define our own typeof in order for null/array to display properly in error messages
export const typeOf = (v: Value): RuntimeType => {
  const typeOfV = typeof v
  if (
    typeOfV === 'string' ||
    typeOfV === 'number' ||
    typeOfV === 'boolean' ||
    typeOfV === 'undefined'
  ) {
    return typeOfV
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

const isNumber = (v: TypedValue) => v.type === 'number'
// See section 4 of https://2ality.com/2012/12/arrays.html
// v >>> 0 === v checks that v is a valid unsigned 32-bit int
// tslint:disable-next-line:no-bitwise
// const isArrayIndex = (v: Value) => isNumber(v) && v >>> 0 === v && v < 2 ** 32 - 1
const isString = (v: TypedValue) => v.type === 'string'
const isBool = (v: TypedValue) => v.type === 'boolean'
// const isObject = (v: Value) => typeOf(v) === 'object'
// const isArray = (v: Value) => typeOf(v) === 'array'

export const typeOfFunction = (
  node: babel.FunctionDeclaration | babel.ArrowFunctionExpression
): RuntimeFunctionType => {
  const returnType = convertToRuntimeType(
    (node.returnType as babel.TSTypeAnnotation).typeAnnotation
  )
  const paramTypes: RuntimeType[] = node.params.map(id => {
    const type = (id as babel.Identifier).typeAnnotation as babel.TSTypeAnnotation
    return convertToRuntimeType(type.typeAnnotation)
  })
  return { paramTypes, returnType }
}

const convertToRuntimeType = (t: babel.TSType): RuntimeType => {
  switch (t.type) {
    case 'TSAnyKeyword':
      throw new Error('Any types are not supported in x-slang')
    case 'TSBigIntKeyword':
      throw new Error('BigInts are not supported in x-slang')
    case 'TSBooleanKeyword':
      return 'boolean'
    case 'TSIntrinsicKeyword':
      throw new Error('TS Intrinsic Keywords are not supported in x-slang')
    case 'TSLiteralType':
      throw new Error('TS Literal Types are not supported in x-slang')
    case 'TSNeverKeyword':
      throw new Error('TS Never Keywords are not supported in x-slang')
    case 'TSNullKeyword':
      throw new Error('TS Null keywords are not supported in x-slang')
    case 'TSNumberKeyword':
      return 'number'
    case 'TSObjectKeyword':
      throw new Error('TS Object Keywords are not supported in x-slang')
    case 'TSStringKeyword':
      return 'string'
    case 'TSSymbolKeyword':
      throw new Error('TS Symbol Keywords are not supported in x-slang')
    case 'TSThisType':
      throw new Error('TS This Types are not supported in x-slang')
    case 'TSUndefinedKeyword':
      return 'undefined'
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
      throw new Error('TS Type Reference is not supported in x-slang') // TODO: handle this
    default:
      // TSConstructorType | TSTypePredicate | TSTypeQuery | TSTypeLiteral | TSArrayType | TSTupleType | TSOptionalType | TSRestType | TSUnionType | TSIntersectionType | TSConditionalType | TSInferType | TSParenthesizedType | TSTypeOperator | TSIndexedAccessType | TSMappedType | TSExpressionWithTypeArguments | TSImportType
      throw new Error(`Unknown type in convertToRuntimeType: ${t.type}`)
  }
}

const isMatchingType = (t1: RuntimeType, t2: RuntimeType): boolean => {
  // TODO: deal with 'any'
  if (!isObject(t1) || !isObject(t2)) {
    return t1 === t2
  }
  return (
    isMatchingType(t1.returnType, t2.returnType) && isMatchingTypes(t1.paramTypes, t2.paramTypes)
  )
}

const isMatchingTypes = (t1: RuntimeType[], t2: RuntimeType[]) => {
  if (t1.length === 0 && t2.length === 0) {
    return true
  } else if (t1.length !== t2.length) {
    return false
  }
  for (let i = 0; i < t1.length; i++) {
    if (!isMatchingType(t1[i], t2[i])) {
      return false
    }
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
  node: babel.FunctionDeclaration | babel.ArrowFunctionExpression
) => {
  // TODO: better toString() for arrow function errors
  const functionName = babel.isFunctionDeclaration(node)
    ? `function ${node.id!.name}`
    : 'arrow function'
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

const rttToString = (t: RuntimeType): string =>
  isObject(t)
    ? `(${t.paramTypes.map(type => rttToString(type)).join(', ')}) => ${rttToString(t.returnType)}`
    : t
