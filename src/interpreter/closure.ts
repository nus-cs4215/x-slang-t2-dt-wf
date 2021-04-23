/* tslint:disable:max-classes-per-file */
import { generate } from 'astring'
import * as babel from '@babel/types'

import { Context, Environment, Value } from '../types'
import {
  blockArrowFunction,
  callExpression,
  identifier,
  returnStatement
} from '../utils/astCreator'
import { apply } from './interpreter'

const closureToJS = (value: Closure, context: Context, klass: string) => {
  function DummyClass(this: Closure) {
    const args: Value[] = Array.prototype.slice.call(arguments)
    const gen = apply(
      context,
      // TODO: figure out what this does
      { type: { kind: 'undefined' }, value },
      args,
      [],
      (callExpression(identifier(klass), args) as unknown) as babel.CallExpression,
      this
    )
    let it = gen.next()
    while (!it.done) {
      it = gen.next()
    }
    return it.value
  }
  Object.defineProperty(DummyClass, 'name', {
    value: klass
  })
  Object.setPrototypeOf(DummyClass, () => undefined)
  Object.defineProperty(DummyClass, 'Inherits', {
    value: (Parent: Value) => {
      DummyClass.prototype = Object.create(Parent.prototype)
      DummyClass.prototype.constructor = DummyClass
    }
  })
  DummyClass.toString = () => generate(value.originalNode)
  DummyClass.call = (thisArg: Value, ...args: Value[]): any => {
    return DummyClass.apply(thisArg, args)
  }
  return DummyClass
}

class Callable extends Function {
  constructor(f: any) {
    super()
    return Object.setPrototypeOf(f, new.target.prototype)
  }
}

/**
 * Models function value in the interpreter environment.
 */
export default class Closure extends Callable {
  public static makeFromArrowFunction(
    node: babel.ArrowFunctionExpression,
    environment: Environment,
    context: Context
  ) {
    function isExpressionBody(
      body: babel.BlockStatement | babel.Expression
    ): body is babel.Expression {
      return body.type !== 'BlockStatement'
    }
    const functionBody = isExpressionBody(node.body)
      ? [returnStatement(node.body, node.body.loc)]
      : node.body
    const closure = new Closure(
      blockArrowFunction(
        node.params as babel.Identifier[],
        functionBody,
        node.loc,
        node.returnType as babel.TSTypeAnnotation | null,
        node.typeParameters as babel.TSTypeParameterDeclaration | null
      ),
      environment,
      context
    )

    // Set the closure's node to point back at the original one
    closure.originalNode = node

    return closure
  }

  /** Unique ID defined for anonymous closure */
  public functionName: string

  /** Fake closure function */
  // tslint:disable-next-line:ban-types
  public fun: Function

  /** The original node that created this Closure */
  public originalNode: babel.Function

  constructor(public node: babel.Function, public environment: Environment, context: Context) {
    super(function (this: any, ...args: any[]) {
      return funJS.apply(this, args)
    })
    this.originalNode = node
    if (this.node.type === 'FunctionDeclaration' && this.node.id !== null) {
      this.functionName = this.node.id.name
    } else {
      this.functionName =
        (this.node.params.length === 1 ? '' : '(') +
        this.node.params.map((o: babel.Identifier) => o.name).join(', ') +
        (this.node.params.length === 1 ? '' : ')') +
        ' => ...'
    }
    // TODO: Investigate how relevant this really is.
    // .fun seems to only be used in interpreter's NewExpression handler, which uses .fun.prototype.
    const funJS = closureToJS(this, context, this.functionName)
    this.fun = funJS
  }

  public toString(): string {
    return generate(this.originalNode)
  }
}
