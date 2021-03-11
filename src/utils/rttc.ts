import * as es from 'estree'
import * as babel from '@babel/types'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import { ErrorSeverity, ErrorType, TypeAnnotatedNode, Value } from '../types'

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
const typeOf = (v: Value) => {
  if (v === null) {
    return 'null'
  } else if (Array.isArray(v)) {
    return 'array'
  } else {
    return typeof v
  }
}

const isNumber = (v: Value) => typeOf(v) === 'number'
// See section 4 of https://2ality.com/2012/12/arrays.html
// v >>> 0 === v checks that v is a valid unsigned 32-bit int
// tslint:disable-next-line:no-bitwise
const isArrayIndex = (v: Value) => isNumber(v) && v >>> 0 === v && v < 2 ** 32 - 1
const isString = (v: Value) => typeOf(v) === 'string'
const isBool = (v: Value) => typeOf(v) === 'boolean'
const isObject = (v: Value) => typeOf(v) === 'object'
const isArray = (v: Value) => typeOf(v) === 'array'

const getCorrespondingType = (t: babel.TSBaseType) => {
  switch (t.type) {
    case 'TSAnyKeyword':
      return 'any'
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
      return 'null'
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

const isMatchingType = (t: babel.TSBaseType, v: Value) => {
  const typeToMatch = getCorrespondingType(t)
  // TODO: deal with 'any' properly
  return typeToMatch === 'any' || typeToMatch === typeOf(v)
  // NOTE: this most likely will not work with array indexes
}

export const checkUnaryExpression = (node: es.Node, operator: es.UnaryOperator, value: Value) => {
  if ((operator === '+' || operator === '-') && !isNumber(value)) {
    return new TypeError(node, '', 'number', typeOf(value))
  } else if (operator === '!' && !isBool(value)) {
    return new TypeError(node, '', 'boolean', typeOf(value))
  } else {
    return undefined
  }
}

export const checkBinaryExpression = (
  node: es.Node,
  operator: es.BinaryOperator,
  left: Value,
  right: Value
) => {
  switch (operator) {
    case '-':
    case '*':
    case '/':
    case '%':
      if (!isNumber(left)) {
        return new TypeError(node, LHS, 'number', typeOf(left))
      } else if (!isNumber(right)) {
        return new TypeError(node, RHS, 'number', typeOf(right))
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
        return isNumber(right) ? undefined : new TypeError(node, RHS, 'number', typeOf(right))
      } else if (isString(left)) {
        return isString(right) ? undefined : new TypeError(node, RHS, 'string', typeOf(right))
      } else {
        return new TypeError(node, LHS, 'string or number', typeOf(left))
      }
    default:
      return
  }
}

export const checkIfStatement = (node: es.Node, test: Value) => {
  return isBool(test) ? undefined : new TypeError(node, ' as condition', 'boolean', typeOf(test))
}

export const checkMemberAccess = (node: es.Node, obj: Value, prop: Value) => {
  if (isObject(obj)) {
    return isString(prop) ? undefined : new TypeError(node, ' as prop', 'string', typeOf(prop))
  } else if (isArray(obj)) {
    return isArrayIndex(prop)
      ? undefined
      : isNumber(prop)
      ? new TypeError(node, ' as prop', 'array index', 'other number')
      : new TypeError(node, ' as prop', 'array index', typeOf(prop))
  } else {
    return new TypeError(node, '', 'object or array', typeOf(obj))
  }
}

export const checkVariableDeclaration = (
  node: TypeAnnotatedNode<babel.Node>,
  id: babel.Identifier,
  init: Value
) => {
  // TODO: use inferred types instead of type annotations for type checking?
  if (!id.typeAnnotation) {
    return new TypeError(node, ' after name declaration', 'type annotation', 'none')
  } else if (id.typeAnnotation.type !== 'TSTypeAnnotation') {
    return new TypeError(node, '', 'TSTypeAnnotation', id.typeAnnotation.type)
  } else if (!babel.isTSBaseType(id.typeAnnotation.typeAnnotation)) {
    // TODO: implement other types (e.g. functions)
    return new TypeError(node, '', 'TypeScript base type', id.typeAnnotation.typeAnnotation.type)
  } else if (!isMatchingType(id.typeAnnotation.typeAnnotation, init)) {
    return new TypeError(
      node,
      ' on right hand side of declaration',
      getCorrespondingType(id.typeAnnotation.typeAnnotation),
      typeOf(init)
    )
  } else {
    return undefined
  }
}
