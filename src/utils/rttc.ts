import * as babel from '@babel/types'
import * as es from 'estree'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import { ErrorSeverity, ErrorType, RuntimeType, TypedValue, Value } from '../types'

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

const getCorrespondingType = (t: babel.TSBaseType) => {
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
      throw new Error('TS Undefined Keywords are not supported in x-slang') // TODO: handle this
    case 'TSVoidKeyword':
      throw new Error('TS Void Keywords are not supported in x-slang') // TODO: when adding functions
    default:
      throw new Error(`Unknown type in getCorrespondingType: ${t.type}`)
  }
}

const isMatchingType = (tsType: babel.TSBaseType, runtimeType: RuntimeType) => {
  const typeToMatch = getCorrespondingType(tsType)
  // TODO: deal with 'any' properly
  return typeToMatch === runtimeType
  // NOTE: this most likely will not work with array indexes
}

export const checkUnaryExpression = (
  node: es.Node,
  operator: es.UnaryOperator,
  value: TypedValue
) => {
  if ((operator === '+' || operator === '-') && !isNumber(value)) {
    return new TypeError(node, '', 'number', value.type)
  } else if (operator === '!' && !isBool(value)) {
    return new TypeError(node, '', 'boolean', value.type)
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
        return new TypeError(node, LHS, 'number', left.type)
      } else if (!isNumber(right)) {
        return new TypeError(node, RHS, 'number', right.type)
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
        return isNumber(right) ? undefined : new TypeError(node, RHS, 'number', right.type)
      } else if (isString(left)) {
        return isString(right) ? undefined : new TypeError(node, RHS, 'string', right.type)
      } else {
        return new TypeError(node, LHS, 'string or number', left.type)
      }
    default:
      return
  }
}

export const checkIfStatement = (node: es.Node, test: TypedValue) => {
  return isBool(test) ? undefined : new TypeError(node, ' as condition', 'boolean', test.type)
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

export const checkVariableDeclaration = (
  node: babel.VariableDeclaration,
  id: babel.Identifier,
  init: TypedValue
) => {
  if (!id.typeAnnotation) {
    return new TypeError(node, ` name for variable ${id.name}`, 'type annotation', 'none')
  } else if (id.typeAnnotation.type !== 'TSTypeAnnotation') {
    return new TypeError(node, '', 'TSTypeAnnotation', id.typeAnnotation.type) //parser error
  } else if (!babel.isTSBaseType(id.typeAnnotation.typeAnnotation)) {
    return new TypeError(node, '', 'TypeScript base type', id.typeAnnotation.typeAnnotation.type) //TODO: check whether this can happen
  } else if (!isMatchingType(id.typeAnnotation.typeAnnotation, init.type)) {
    return new TypeError(
      node,
      ` as type of ${id.name}`,
      getCorrespondingType(id.typeAnnotation.typeAnnotation),
      init.type
    )
  } else {
    return undefined
  }
}
