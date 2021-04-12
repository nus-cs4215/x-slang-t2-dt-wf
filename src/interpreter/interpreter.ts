/* tslint:disable:max-classes-per-file */
import * as babel from '@babel/types'
import * as es from 'estree'
import * as constants from '../constants'
import * as errors from '../errors/errors'
import { RuntimeSourceError } from '../errors/runtimeSourceError'
import {
  Context,
  DECLARED_BUT_NOT_YET_ASSIGNED,
  Environment,
  Frame,
  isIdentifier,
  RuntimeFunctionType,
  RuntimeType,
  RuntimeTyped,
  TypedValue,
  Value
} from '../types'
import { conditionalExpression, literal, primitive } from '../utils/astCreator'
import { evaluateBinaryExpression, evaluateUnaryExpression } from '../utils/operators'
import * as rttc from '../utils/rttc'
import Closure from './closure'

class BreakValue {}

class ContinueValue {}

class ReturnValue {
  constructor(public value: TypedValue) {}
}

class TailCallReturnValue {
  constructor(
    public callee: RuntimeTyped<Closure>,
    public args: Value[],
    public typeArgs: RuntimeType[],
    public node: babel.CallExpression
  ) {}
}

// TODO: remove for convenience? (not lazy)
class Thunk {
  public value: Value
  public isMemoized: boolean
  constructor(public exp: es.Node, public env: Environment) {
    this.isMemoized = false
    this.value = null
  }
}

function* forceIt(val: any, context: Context): Value {
  if (val instanceof Thunk) {
    if (val.isMemoized) return val.value

    pushEnvironment(context, val.env)
    const evalRes = yield* actualValue(val.exp, context)
    popEnvironment(context)
    val.value = evalRes
    val.isMemoized = true
    return evalRes
  } else return val
}

export function* actualValue(exp: es.Node, context: Context): Value {
  const evalResult = yield* evaluate(exp, context)
  const forced = yield* forceIt(evalResult, context)
  return forced
}

const createEnvironment = (
  closure: Closure,
  args: TypedValue[],
  callExpression?: babel.CallExpression,
  typeArgs?: RuntimeType[]
): Environment => {
  const environment: Environment = {
    name: closure.functionName, // TODO: Change this
    tail: closure.environment,
    head: makeEmptyFrame()
  }
  if (callExpression) {
    environment.callExpression = {
      ...callExpression,
      // TODO: check that it matches babel types
      arguments: (args.map(primitive) as unknown) as babel.Expression[]
    }
  }
  closure.node.params.forEach((param, index) => {
    const identifier = param as babel.Identifier
    environment.head.values[identifier.name] = args[index]
  })
  if (closure.node.typeParameters && typeArgs) {
    // NOTE: the presence of typeArgs (if typeParameters are defined) is checked before this function is called
    const typeParams = (closure.node.typeParameters as babel.TSTypeParameterDeclaration).params
    typeParams.forEach((param, index) => {
      environment.head.types[param.name] = typeArgs[index]
    })
  }
  return environment
}

const createBlockEnvironment = (
  context: Context,
  name = 'blockEnvironment',
  head: Frame = makeEmptyFrame()
): Environment => {
  return {
    name,
    tail: currentEnvironment(context),
    head
  }
}

const handleRuntimeError = (context: Context, error: RuntimeSourceError): never => {
  context.errors.push(error)
  context.runtime.environments = context.runtime.environments.slice(
    -context.numberOfOuterEnvironments
  )
  throw error
}

function declareIdentifier(context: Context, name: string, node: es.Node) {
  const environment = currentEnvironment(context)
  if (environment.head.values.hasOwnProperty(name)) {
    const descriptors = Object.getOwnPropertyDescriptors(environment.head.values)

    return handleRuntimeError(
      context,
      new errors.VariableRedeclaration(node, name, descriptors[name].writable)
    )
  }
  environment.head.values[name] = DECLARED_BUT_NOT_YET_ASSIGNED
  return environment
}

function declareVariables(context: Context, node: es.VariableDeclaration) {
  for (const declaration of node.declarations) {
    declareIdentifier(context, (declaration.id as es.Identifier).name, node)
  }
}

function declareFunctionsAndVariables(context: Context, node: es.BlockStatement) {
  for (const statement of node.body) {
    switch (statement.type) {
      case 'VariableDeclaration':
        declareVariables(context, statement)
        break
      case 'FunctionDeclaration':
        declareIdentifier(context, (statement.id as es.Identifier).name, statement)
        break
    }
  }
}

function defineVariable(
  context: Context,
  id: babel.Identifier,
  value: TypedValue,
  node: babel.VariableDeclaration | babel.FunctionDeclaration
) {
  const name = id.name
  const environment = currentEnvironment(context)
  if (environment.head.values[name] !== DECLARED_BUT_NOT_YET_ASSIGNED) {
    // TODO: why does js-slang use context.runtime.nodes?
    handleRuntimeError(
      context,
      new errors.VariableRedeclaration((node as unknown) as es.Node, name)
    )
  }
  environment.head.values[name] = value
}

function lookupVariable(context: Context, name: string, node: es.Identifier) {
  let environment: Environment = currentEnvironment(context)
  while (true) {
    if (environment.head.values.hasOwnProperty(name)) {
      const result = environment.head.values[name]
      if (result === DECLARED_BUT_NOT_YET_ASSIGNED) {
        return handleRuntimeError(context, new errors.UnassignedVariable(name, node))
      }
      return result
    }
    if (environment.tail === null) {
      return handleRuntimeError(context, new errors.UndefinedVariable(name, node))
    }
    environment = environment.tail
  }
}

function* visit(context: Context, node: es.Node) {
  context.runtime.nodes.unshift(node)
  yield context
}

function* leave(context: Context) {
  context.runtime.nodes.shift()
  yield context
}

const currentEnvironment = (context: Context) => context.runtime.environments[0]
const replaceEnvironment = (context: Context, environment: Environment) =>
  (context.runtime.environments[0] = environment)
const popEnvironment = (context: Context) => context.runtime.environments.shift()
const pushEnvironment = (context: Context, environment: Environment) =>
  context.runtime.environments.unshift(environment)

const makeEmptyFrame = () => ({ types: {}, values: {} })

const checkNumberOfArguments = (
  context: Context,
  callee: Closure | Value,
  args: Value[],
  exp: babel.CallExpression
) => {
  // TODO: should this be checked using types or node?
  if (callee instanceof Closure) {
    if (callee.node.params.length !== args.length) {
      return handleRuntimeError(
        context,
        new errors.InvalidNumberOfArguments(exp, callee.node.params.length, args.length)
      )
    }
  } else {
    if (callee.hasVarArgs === false && callee.length !== args.length) {
      return handleRuntimeError(
        context,
        new errors.InvalidNumberOfArguments(exp, callee.length, args.length)
      )
    }
  }
  return undefined
}

const checkNumberOfTypeArguments = (
  context: Context,
  functionType: RuntimeFunctionType,
  typeArgs: RuntimeType[],
  exp: babel.CallExpression
) => {
  // TODO: should this be checking the Closure instead?
  if (functionType.typeParams.length !== typeArgs.length) {
    return handleRuntimeError(
      context,
      new errors.InvalidNumberOfTypeArguments(exp, functionType.typeParams.length, typeArgs.length)
    )
  }
  return undefined
}

function* getArgs(context: Context, call: es.CallExpression) {
  const args = []
  for (const arg of call.arguments) {
    args.push(yield* actualValue(arg, context))
  }
  return args
}

export type Evaluator<T extends es.Node> = (node: T, context: Context) => IterableIterator<Value>

function* evaluateBlockStatement(context: Context, node: es.BlockStatement) {
  // TODO: declare types
  declareFunctionsAndVariables(context, node)
  let result
  for (const statement of node.body) {
    result = yield* evaluate(statement, context)
    if (
      result instanceof ReturnValue ||
      result instanceof TailCallReturnValue ||
      result instanceof BreakValue ||
      result instanceof ContinueValue
    ) {
      break
    }
  }
  return result
}

/**
 * WARNING: Do not use object literal shorthands, e.g.
 *   {
 *     *Literal(node: es.Literal, ...) {...},
 *     *ThisExpression(node: es.ThisExpression, ..._ {...},
 *     ...
 *   }
 * They do not minify well, raising uncaught syntax errors in production.
 * See: https://github.com/webpack/webpack/issues/7566
 */
// tslint:disable:object-literal-shorthand
// prettier-ignore
export const evaluators: { [nodeType: string]: Evaluator<es.Node> } = {
    /** Simple Values */
    Literal: function*(node: es.Literal, context: Context) {
        const type = rttc.typeOf(node.value);
        return { type, value: node.value };
    },

    TemplateLiteral: function*(node: es.TemplateLiteral) {
        // Expressions like `${1}` are not allowed, so no processing needed
        return node.quasis[0].value.cooked
    },

    ThisExpression: function*(node: es.ThisExpression, context: Context) {
        return context.runtime.environments[0].thisContext
    },

    ArrayExpression: function*(node: es.ArrayExpression, context: Context) {
        throw new Error("Array expressions not supported in x-slang");
    },

    DebuggerStatement: function*(node: es.DebuggerStatement, context: Context) {
        yield
    },

    FunctionExpression: function*(node: es.FunctionExpression, context: Context) {
        const currentEnv = currentEnvironment(context)
        const error = rttc.checkFunctionDeclaration(node as unknown as babel.FunctionExpression, currentEnv)
        if (error) {
          handleRuntimeError(context, error)
        }

        const functionType = rttc.typeOfFunction(node as unknown as babel.FunctionExpression, currentEnv)
        const closure = new Closure(node as unknown as babel.FunctionExpression, currentEnv, context)
        return { type: functionType, value: closure }
    },

    ArrowFunctionExpression: function*(node: es.ArrowFunctionExpression, context: Context) {
        const currentEnv = currentEnvironment(context)
        const error = rttc.checkFunctionDeclaration(node as unknown as babel.ArrowFunctionExpression, currentEnv);
        if (error) {
          return handleRuntimeError(context, error);
        }

        const functionType = rttc.typeOfFunction(node as unknown as babel.ArrowFunctionExpression, currentEnv);
        const closure = Closure.makeFromArrowFunction(node, currentEnv, context);
        return { type: functionType, value: closure};
    },

    Identifier: function*(node: es.Identifier, context: Context) {
        return lookupVariable(context, node.name, node);
    },

    CallExpression: function*(node: es.CallExpression, context: Context) {
      const babelNode = node as  unknown as babel.CallExpression;

      const callee = yield* actualValue(node.callee, context)
      const error = rttc.checkCallee(node as unknown as babel.CallExpression, callee)
      if (error) {
        return handleRuntimeError(context, error)
      }
      const args = yield* getArgs(context, node)
      const typeArgsOrError = rttc.getTypeArgs(babelNode.typeParameters, currentEnvironment(context))
      if (typeArgsOrError instanceof RuntimeSourceError) {
        return handleRuntimeError(context, typeArgsOrError)
      }

      const result = yield* apply(context, callee, args, typeArgsOrError, babelNode)
      return result
    },

    NewExpression: function*(node: es.NewExpression, context: Context) {
        const callee = yield* evaluate(node.callee, context)
        const args = []
        for (const arg of node.arguments) {
            args.push(yield* evaluate(arg, context))
        }
        const obj: Value = {}
        if (callee instanceof Closure) {
            obj.__proto__ = callee.fun.prototype
            callee.fun.apply(obj, args)
        } else {
            obj.__proto__ = callee.prototype
            callee.apply(obj, args)
        }
        return obj
    },

    UnaryExpression: function*(node: es.UnaryExpression, context: Context) {
        const value = yield* actualValue(node.argument, context)

        const error = rttc.checkUnaryExpression(node, node.operator, value)
        if (error) {
            return handleRuntimeError(context, error)
        }
        return evaluateUnaryExpression(node.operator, value)
    },

    BinaryExpression: function*(node: es.BinaryExpression, context: Context) {
        const left = yield* actualValue(node.left, context)
        const right = yield* actualValue(node.right, context)
        const error = rttc.checkBinaryExpression(node, node.operator, left, right)
        if (error) {
            return handleRuntimeError(context, error)
        }
        return evaluateBinaryExpression(node.operator, left, right)
    },

    ConditionalExpression: function*(node: es.ConditionalExpression, context: Context) {
        return yield* this.IfStatement(node, context)
    },

    LogicalExpression: function*(node: es.LogicalExpression, context: Context) {
        throw new Error("Logical expressions not supported in x-slang");
    },

    VariableDeclaration: function*(node: es.VariableDeclaration, context: Context) {
        if (node.kind !== 'const') {
            throw new Error(`${node.kind} statements not supported in x-slang`);
        }
        // We only allow one variable declaration per line
        const declaration = node.declarations[0];
        const id = declaration.id;
        if (!isIdentifier(id)) {
            throw new Error(`${id.type}s in variable declarations are not supported in x-slang`);
        } else if (!declaration.init) {
            throw new Error('Constants must be initialised upon declaration');
        }
        const initValue = yield* actualValue(declaration.init, context);
        // TODO: migrate to babel types
        // TODO: add type information for each contraction step and use that for type checking
        const error = rttc.checkVariableDeclaration(node as unknown as babel.VariableDeclaration, id as unknown as babel.Identifier, initValue) 
        if (error) {
            return handleRuntimeError(context, error)
        }
        // node had a property start and end but does not have innerComments, declare
        defineVariable(context, id as unknown as babel.Identifier, initValue, node as unknown as babel.VariableDeclaration);
        return undefined;
    },

    ContinueStatement: function*(node: es.ContinueStatement, context: Context) {
        throw new Error("Continue statements not supported in x-slang");
    },

    BreakStatement: function*(node: es.BreakStatement, context: Context) {
        throw new Error("Break statements not supported in x-slang");
    },

    ForStatement: function*(node: es.ForStatement, context: Context) {
        // Create a new block scope for the loop variables
        throw new Error("For statements not supported in x-slang");
    },

    MemberExpression: function*(node: es.MemberExpression, context: Context) {
        throw new Error("Member statements not supported in x-slang");
    },

    AssignmentExpression: function*(node: es.AssignmentExpression, context: Context) {
        throw new Error("Assignment expressions not supported in x-slang");
    },

    FunctionDeclaration: function*(node: es.FunctionDeclaration, context: Context) {
      const currentEnv = currentEnvironment(context)
      const error = rttc.checkFunctionDeclaration(node as unknown as babel.FunctionDeclaration, currentEnv)
      if (error) {
        handleRuntimeError(context, error)
      }

      const functionType = rttc.typeOfFunction(node as unknown as babel.FunctionDeclaration, currentEnv)
      const closure = new Closure(node as unknown as babel.FunctionDeclaration, currentEnv, context)
      
      const id = node.id as unknown as babel.Identifier //we are not using es.identifier here
      defineVariable(context, id, {type: functionType, value: closure}, node as unknown as babel.FunctionDeclaration)
      return undefined
    },

    IfStatement: function*(node: es.IfStatement | es.ConditionalExpression, context: Context) {
       return yield* evaluate(yield* reduceIf(node, context), context)
    },

    ExpressionStatement: function*(node: es.ExpressionStatement, context: Context) {
        return yield* evaluate(node.expression, context)
    },

    ReturnStatement: function*(node: es.ReturnStatement, context: Context) {
      let returnExpression = node.argument!

      // If we have a conditional expression, reduce it until we get something else
      while (
        returnExpression.type === 'LogicalExpression' ||
        returnExpression.type === 'ConditionalExpression'
      ) {
        if (returnExpression.type === 'LogicalExpression') {
          returnExpression = transformLogicalExpression(returnExpression)
        }
        returnExpression = yield* reduceIf(returnExpression, context)
      }
  
      // If we are now left with a CallExpression, then we use TCO
      if (returnExpression.type === 'CallExpression') {
        const callee = yield* actualValue(returnExpression.callee, context)
        const error = rttc.checkCallee(returnExpression as unknown as babel.CallExpression, callee)
        if (error) {
          return handleRuntimeError(context, error)
        }
  
        const args = yield* getArgs(context, returnExpression)
        const typeArgsOrError = rttc.getTypeArgs((returnExpression as unknown as babel.CallExpression).typeParameters, currentEnvironment(context))
        if (typeArgsOrError instanceof RuntimeSourceError) {
          return handleRuntimeError(context, typeArgsOrError)
        }  
        return new TailCallReturnValue(callee, args, typeArgsOrError, returnExpression as unknown as babel.CallExpression)
      } else {
        return new ReturnValue(yield* evaluate(returnExpression, context))
      }
    },

    WhileStatement: function*(node: es.WhileStatement, context: Context) {
        throw new Error("While statements not supported in x-slang");
    },

    ObjectExpression: function*(node: es.ObjectExpression, context: Context) {
        throw new Error("Object expressions not supported in x-slang");
    },

    BlockStatement: function*(node: es.BlockStatement, context: Context) {
      // Create a new environment (block scoping)
      const environment = createBlockEnvironment(context, 'blockEnvironment')
      pushEnvironment(context, environment)
      const result: Value = yield* evaluateBlockStatement(context, node)
      popEnvironment(context)
      return result
    },

    ImportDeclaration: function*(node: es.ImportDeclaration, context: Context) {
        throw new Error("Import declarations not supported in x-slang");
    },

    Program: function*(node: es.BlockStatement, context: Context) {
        context.numberOfOuterEnvironments += 1
        const environment = createBlockEnvironment(context, 'programEnvironment')
        pushEnvironment(context, environment)
        const result = yield* forceIt(yield* evaluateBlockStatement(context, node), context);
        return result;
    }
}

function transformLogicalExpression(node: es.LogicalExpression): es.ConditionalExpression {
  if (node.operator === '&&') {
    return conditionalExpression(node.left, node.right, literal(false), node.loc!)
  } else {
    return conditionalExpression(node.left, literal(true), node.right, node.loc!)
  }
}

function* reduceIf(
  node: es.IfStatement | es.ConditionalExpression,
  context: Context
): IterableIterator<es.Node> {
  const test = yield* actualValue(node.test, context)

  const error = rttc.checkIfStatement(node, test)
  if (error) {
    return handleRuntimeError(context, error)
  }

  return test.value ? node.consequent : node.alternate
}

// tslint:enable:object-literal-shorthand

export function* evaluate(node: es.Node, context: Context) {
  yield* visit(context, node)
  const result = yield* evaluators[node.type](node, context)
  yield* leave(context)
  return result
}

export function* apply(
  context: Context,
  fun: RuntimeTyped<Closure> | TypedValue,
  args: TypedValue[],
  typeArgs: RuntimeType[],
  node: babel.CallExpression,
  thisContext?: Value
) {
  let result: Value
  let total = 0

  while (!(result instanceof ReturnValue)) {
    if (fun.value instanceof Closure) {
      checkNumberOfArguments(context, fun, args, node!)
      checkNumberOfTypeArguments(context, fun.type as RuntimeFunctionType, typeArgs, node!)

      const error = rttc.checkTypeOfArguments(
        (node! as unknown) as babel.CallExpression,
        fun.type as RuntimeFunctionType,
        args,
        typeArgs,
        currentEnvironment(context)
      )
      if (error) {
        return handleRuntimeError(context, error)
      }

      const environment = createEnvironment(fun.value, args, node, typeArgs)
      if (result instanceof TailCallReturnValue) {
        replaceEnvironment(context, environment)
      } else {
        pushEnvironment(context, environment)
        total++
      }

      const bodyEnvironment = createBlockEnvironment(context, 'functionBodyEnvironment')
      bodyEnvironment.thisContext = thisContext
      pushEnvironment(context, bodyEnvironment)
      result = yield* evaluateBlockStatement(
        context,
        (fun.value.node.body as unknown) as es.BlockStatement
      )
      popEnvironment(context)
      if (result instanceof TailCallReturnValue) {
        fun = result.callee
        node = result.node
        args = result.args
        // TODO: typeArgs
      } else if (!(result instanceof ReturnValue)) {
        // No Return Value, set it as undefined
        result = new ReturnValue({ type: rttc.runtimeUndefined, value: undefined })
      }
    } else if (typeof fun.value === 'function') {
      checkNumberOfArguments(context, fun, args, node!)
      // TODO: check if/when this is called
      try {
        const forcedArgs = []

        for (const arg of args) {
          forcedArgs.push(yield* forceIt(arg, context))
        }

        result = fun.value.apply(thisContext, forcedArgs)
        break
      } catch (e) {
        // Recover from exception
        context.runtime.environments = context.runtime.environments.slice(
          -context.numberOfOuterEnvironments
        )

        const loc = node ? node.loc! : constants.UNKNOWN_LOCATION
        if (!(e instanceof RuntimeSourceError || e instanceof errors.ExceptionError)) {
          // The error could've arisen when the builtin called a source function which errored.
          // If the cause was a source error, we don't want to include the error.
          // However if the error came from the builtin itself, we need to handle it.
          return handleRuntimeError(context, new errors.ExceptionError(e, loc))
        }
        result = undefined
        throw e
      }
    } else {
      return handleRuntimeError(context, new errors.CallingNonFunctionValue(fun, node))
    }
  }
  // Unwraps return value and release stack environment
  if (result instanceof ReturnValue) {
    const error = rttc.checkTypeOfReturnValue(
      (node! as unknown) as babel.CallExpression,
      fun.type as RuntimeFunctionType,
      result.value,
      currentEnvironment(context)
    )
    if (error) {
      return handleRuntimeError(context, error)
    }
    result = result.value
  }
  for (let i = 1; i <= total; i++) {
    popEnvironment(context)
  }
  return result
}
