import * as es from 'estree'
import * as babel from '@babel/types'
import { AllowedDeclarations, BlockExpression, FunctionDeclarationExpression } from '../types'

// TODO: convert everything to babel types

export const getVariableDecarationName = (decl: es.VariableDeclaration) =>
  (decl.declarations[0].id as es.Identifier).name

export const locationDummyNode = (line: number, column: number) =>
  literal('Dummy', { start: { line, column }, end: { line, column } })

export const identifier = (name: string, loc?: es.SourceLocation | null): es.Identifier => ({
  type: 'Identifier',
  name,
  loc
})

export const literal = (
  value: string | number | boolean,
  loc?: es.SourceLocation | null
): es.Literal => ({
  type: 'Literal',
  value,
  loc
})

export const memberExpression = (
  object: es.Expression,
  propertyString: string
): es.MemberExpression => ({
  type: 'MemberExpression',
  object,
  computed: false,
  optional: false,
  property: identifier(propertyString)
})

export const declaration = (
  name: string,
  kind: AllowedDeclarations,
  init: es.Expression,
  loc?: es.SourceLocation | null
): es.VariableDeclaration => ({
  type: 'VariableDeclaration',
  declarations: [
    {
      type: 'VariableDeclarator',
      id: identifier(name),
      init
    }
  ],
  kind,
  loc
})

export const constantDeclaration = (
  name: string,
  init: es.Expression,
  loc?: es.SourceLocation | null
) => declaration(name, 'const', init, loc)

export const callExpression = (
  callee: es.Expression,
  args: es.Expression[],
  loc?: es.SourceLocation | null
): es.CallExpression => ({
  type: 'CallExpression',
  callee,
  arguments: args,
  optional: false,
  loc
})

export const expressionStatement = (expression: es.Expression): es.ExpressionStatement => ({
  type: 'ExpressionStatement',
  expression
})

export const blockArrowFunction = (
  params: babel.Identifier[],
  body: babel.Statement[] | babel.BlockStatement,
  loc: babel.SourceLocation | null,
  returnType: babel.TSTypeAnnotation | null,
  typeParameters: babel.TSTypeParameterDeclaration | null
): babel.ArrowFunctionExpression => ({
  type: 'ArrowFunctionExpression',
  start: null,
  end: null,
  leadingComments: null,
  trailingComments: null,
  innerComments: null,
  async: false,
  expression: false,
  generator: false,
  params,
  body: Array.isArray(body) ? blockStatement(body) : body,
  loc,
  returnType,
  typeParameters
})

export const functionExpression = (
  params: babel.Identifier[],
  body: babel.Statement[] | babel.BlockStatement,
  loc: babel.SourceLocation | null,
  returnType: babel.TSTypeAnnotation | null,
  typeParameters: babel.TSTypeParameterDeclaration | null
): babel.FunctionExpression => ({
  type: 'FunctionExpression',
  start: null,
  end: null,
  leadingComments: null,
  trailingComments: null,
  innerComments: null,
  id: null,
  async: false,
  generator: false,
  params,
  body: Array.isArray(body) ? blockStatement(body) : body,
  loc,
  returnType,
  typeParameters
})

export const blockStatement = (body: babel.Statement[]): babel.BlockStatement => ({
  type: 'BlockStatement',
  start: null,
  end: null,
  leadingComments: null,
  trailingComments: null,
  innerComments: null,
  directives: [],
  loc: null,
  body
})

export const program = (body: es.Statement[]): es.Program => ({
  type: 'Program',
  sourceType: 'module',
  body
})

export const returnStatement = (
  argument: babel.Expression,
  loc: babel.SourceLocation | null
): babel.ReturnStatement => ({
  type: 'ReturnStatement',
  start: null,
  end: null,
  leadingComments: null,
  innerComments: null,
  trailingComments: null,
  argument,
  loc
})

export const property = (key: string, value: es.Expression): es.Property => ({
  type: 'Property',
  method: false,
  shorthand: false,
  computed: false,
  key: identifier(key),
  value,
  kind: 'init'
})

export const objectExpression = (properties: es.Property[]): es.ObjectExpression => ({
  type: 'ObjectExpression',
  properties
})

export const mutateToCallExpression = (
  node: es.Node,
  callee: es.Expression,
  args: es.Expression[]
) => {
  node.type = 'CallExpression'
  node = node as es.CallExpression
  node.callee = callee
  node.arguments = args
}

export const mutateToAssignmentExpression = (
  node: es.Node,
  left: es.Pattern,
  right: es.Expression
) => {
  node.type = 'AssignmentExpression'
  node = node as es.AssignmentExpression
  node.operator = '='
  node.left = left
  node.right = right
}

export const mutateToExpressionStatement = (node: es.Node, expr: es.Expression) => {
  node.type = 'ExpressionStatement'
  node = node as es.ExpressionStatement
  node.expression = expr
}

export const mutateToReturnStatement = (node: es.Node, expr: es.Expression) => {
  node.type = 'ReturnStatement'
  node = node as es.ReturnStatement
  node.argument = expr
}

export const mutateToMemberExpression = (
  node: es.Node,
  obj: es.Expression,
  prop: es.Expression
) => {
  node.type = 'MemberExpression'
  node = node as es.MemberExpression
  node.object = obj
  node.property = prop
  node.computed = false
}

export const logicalExpression = (
  operator: es.LogicalOperator,
  left: es.Expression,
  right: es.Expression,
  loc?: es.SourceLocation | null
): es.LogicalExpression => ({
  type: 'LogicalExpression',
  operator,
  left,
  right,
  loc
})

export const conditionalExpression = (
  test: es.Expression,
  consequent: es.Expression,
  alternate: es.Expression,
  loc?: es.SourceLocation | null
): es.ConditionalExpression => ({
  type: 'ConditionalExpression',
  test,
  consequent,
  alternate,
  loc
})

export const arrayExpression = (elements: es.Expression[]): es.ArrayExpression => ({
  type: 'ArrayExpression',
  elements
})

export const assignmentExpression = (
  left: es.Identifier | es.MemberExpression,
  right: es.Expression
): es.AssignmentExpression => ({
  type: 'AssignmentExpression',
  operator: '=',
  left,
  right
})

export const binaryExpression = (
  operator: es.BinaryOperator,
  left: es.Expression,
  right: es.Expression,
  loc?: es.SourceLocation | null
): es.BinaryExpression => ({
  type: 'BinaryExpression',
  operator,
  left,
  right,
  loc
})

export const unaryExpression = (
  operator: es.UnaryOperator,
  argument: es.Expression,
  loc?: es.SourceLocation | null
): es.UnaryExpression => ({
  type: 'UnaryExpression',
  operator,
  prefix: true,
  argument,
  loc
})

// primitive: undefined is a possible value
export const primitive = (value: any): es.Expression => {
  return value === undefined ? identifier('undefined') : literal(value)
}

export const functionDeclarationExpression = (
  id: es.Identifier,
  params: es.Pattern[],
  body: es.BlockStatement,
  loc?: es.SourceLocation | null
): FunctionDeclarationExpression => ({
  type: 'FunctionExpression',
  id,
  params,
  body,
  loc
})

export const functionDeclaration = (
  id: es.Identifier | null,
  params: es.Pattern[],
  body: es.BlockStatement,
  loc?: es.SourceLocation | null
): es.FunctionDeclaration => ({
  type: 'FunctionDeclaration',
  id,
  params,
  body,
  loc
})

export const blockExpression = (
  body: es.Statement[],
  loc?: es.SourceLocation | null
): BlockExpression => ({
  type: 'BlockExpression',
  body,
  loc
})

export const arrowFunctionExpression = (
  params: es.Pattern[],
  body: es.Expression | es.BlockStatement,
  loc?: es.SourceLocation | null
): es.ArrowFunctionExpression => ({
  type: 'ArrowFunctionExpression',
  expression: body.type !== 'BlockStatement',
  generator: false,
  params,
  body,
  loc
})

export const variableDeclaration = (
  declarations: es.VariableDeclarator[],
  loc?: es.SourceLocation | null
): es.VariableDeclaration => ({
  type: 'VariableDeclaration',
  kind: 'const',
  declarations,
  loc
})

export const variableDeclarator = (
  id: es.Pattern,
  init: es.Expression,
  loc?: es.SourceLocation | null
): es.VariableDeclarator => ({
  type: 'VariableDeclarator',
  id,
  init,
  loc
})

export const ifStatement = (
  test: es.Expression,
  consequent: es.BlockStatement,
  alternate: es.Statement,
  loc?: es.SourceLocation | null
): es.IfStatement => ({
  type: 'IfStatement',
  test,
  consequent,
  alternate,
  loc
})

export const whileStatement = (
  body: es.BlockStatement,
  test: es.Expression,
  loc?: es.SourceLocation | null
): es.WhileStatement => ({
  type: 'WhileStatement',
  test,
  body,
  loc
})
