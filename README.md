Overview
=====
Welcome to the Dynamic TypeScript!

Dynamic TypeScript is a variant of TypeScript that uses TypeScript syntax with dynamic type checking. 
Its language features are similar to Source §1, but with type annotations. 
Our project comprises of two components, a language interpreter (this repository, [x-slang](https://github.com/nus-cs4215/x-slang-t2-dt-wf)) and a playground where the language can be used (see [x-frontend](https://github.com/nus-cs4215/x-frontend-t2-dt-wf/)).
The playground provides detailed information when an error occurs for a better debugging experience.

The specification of the language can be found [here](dynamic_typescript.pdf).

About Dynamic TypeScript
=====

The native TypeScript compiler performs static type checking and type inference before compiling the program into JavaScript. Any type errors will be found and reported to the programmer at this stage. However, the compiled program does not contain any type information. 

While this allows TypeScript programmers to discover and fix type errors early in the development process, 
it also means that programmers must fix all type errors to observe how the program runs.
One workaround is to use the type `any` (which bypasses static type checks); however, this can lead to runtime errors that are difficult to debug.

In a real-world context, type-related errors can also arise at runtime when calling external APIs or when unserialising data. 
The following example simulates an error that could arise when an external API returns an unexpected value:

```ts
const getFromAPI = (params: string): any => {
    return "My First Movie";
    // getFromAPI returns a string. 
    // Its return type is any to simulate a response from an external API (where types are not guaranteed).
}
const getNumberOfMovies = (name: string): number => {
    return getFromAPI(name); // getNumberOfMovies thinks that getFromAPI returns a number
}

getNumberOfMovies("Toy Story") - 1;
// TypeScript result: NaN (due to string + number)
// In a larger program, this kind of implicit runtime "error" can be difficult to debug.
```

Syntax Validation - Parsing TypeScript
=====
We use babel/Parser APIs to handle our syntax validation process i.e., AST generation. This process allows the user program to be checked and error messages to be returned to the user, if any.

@babel/parser
The Babel parser (previously Babylon) is a JavaScript parser used in Babel.

1. The latest ECMAScript version enabled by default (ES2020).
2. Comment attachment.
3. Support for JSX, Flow, Typescript.
4. Support for experimental language proposals (accepting PRs for anything at least stage-0).

@babel/parser is documented here: <https://babeljs.io/docs/en/babel-parser>


Dynamic Type Checking 
=====

At runtime, each value is tagged with its type. For example, the evaluation of a `+` binary operator combination proceeds as follows.

```ts
(1, number) + (2, number) ⇒ (3, number)
(1, number) + (“hello”, string) ⇒ TypeError
```

The addition of two numbers is valid (and produces a number). However, adding a string to a number results in a type error.
The error message contains details that help with debugging.

Syntax
=====

Note that unlike Source, semi-colons are not required due to the Babel parser's limitations.

1.Literals, primitive operators, conditional expressions

```ts
(1 < 2) ? “abc” : “xyz”;
```

2.Constant declarations
```ts
const x = "hello";
const y: number = 1;
```

Type annotations are optional. If not present, no type checking is performed (the constant's initial value is assumed to have the "correct" type).

3.Function declarations, function calls (including higher-order functions)

```ts
const foo = (x: number): boolean => x < 1;
function goo(x: number) { 
    return (y: number): number => x; 
}
```

Note that parameter types and return types are optional. If not present, they are inferred to be `any`.


4.Generic functions and generic (polymorphic) types 
```ts
const id: <T>(x: T) => T = <T>(x: T): T => x;

id<number>(1); 
id<string>(“hello”);
```
Note: Type arguments (e.g. `<number>`) are compulsory.

More example programs can be found at the [bottom of this document](#example-programs).

Usage
=====

To build,

``` {.}
$ git clone https://<url>/x-slang.git
$ cd x-slang
$ yarn
$ yarn build
```

To add \"x-slang\" to your PATH, build it as per the above
instructions, then run

``` {.}
$ cd dist
$ yarn link
```

Once you've added \"x-slang\" to your PATH, you can run it as follows:

``` {.}
$ x-slang '1 * 1'
```

Alternatively, if you prefer to test it without adding \"x-slang\" to your PATH,
you can use the following shortcuts:

| Command | What it does |
|---|---|
| `make ts` | Compiles the interpreter and starts a REPL session |
| `make run` | Starts a REPL session using the existing compiled interpreter |

``` {.}
ts:
	yarn tsc && node dist/repl/repl.js --variant=typescript

run:
	node dist/repl/repl.js --variant=typescript
```

Using x-slang in x-frontend
===========================================

A common issue when developing modifications to x-slang is how to test
it using your own local frontend. Assume that you have built your own
x-frontend locally, here is how you can make it use your own
x-slang, instead of the one that the Source Academy team has deployed
to npm.

First, build and link your local x-slang:
``` {.}
$ cd x-slang
$ yarn build
$ yarn link
```
Then, from your local copy of x-frontend:
``` {.}
$ cd x-frontend
$ yarn link "x-slang"
```

Then start the frontend and the new x-slang will be used. 

Our Presentation Slides
===========================================
You can find the slides [here](https://docs.google.com/presentation/d/1XfzG18aVm5IXMWypXlmBllvWFPOVmQaDfQXkMBRY2YA/edit?usp=sharing)

## Example Programs

The following example programs serve as test cases for the more complex aspects of the language.

Note that line numbers in error messages are mostly omitted to avoid confusion.

### Generic Functions

Applying a generic function twice with different type parameters:
```ts
function repeat<T>(val: T, n: number, f: (x: T) => T): T {
   return n === 0
       ? val
       : repeat<T>(f(val), n - 1, f);
}

repeat<number>(0, 10, (x: number): number => x + 1); 
// 10
repeat<string>("", 3, (s: string): string => s + "abc"); 
// "abcabcabc"
```

Assigning a generic function to a type-annotated constant:
```ts
function f<T>(x: T): T { 
    return x; 
}
const g: <S>(y: S) => S = f;
// No error
```

A generic function that takes another generic function as argument:
```ts
function f<T>(x: <S>(y: S) => S, y: T): T { 
    return x<T>(y); 
}

function g<R>(z: R): R { 
    return z; 
}
f<number>(g, 1);
// 1

const y: (x: string) => boolean = 
    f<(x: string) => boolean>(g, (y: string): boolean => y < 'hello');
y('abcde');
// true
y('world');
// false

f<number>((x: number): number => x < 0 ? 0 : x, -1)
// Error: Expected <S>(type 'S') => type 'S' as argument 0, got (number) => number
// The argument for a generic function parameter must also be a generic function
```

Invalid type references:
```ts
function f<T>(x: <S>(y: S) => S, y: S): T { 
    return x<T>(y); 
}
// Error: Type S not declared.
// The type parameter 'S' only applies to its own function type (i.e. type of x), 
// so the type reference in parameter y's annotation is not declared.
```
```ts
function f<T>(x: <S>(y: S) => (z: T) => R, y: T): T { 
    return x<T>(y); 
}
// Error: Type R not declared.
```

Generic lambda expression + type reference in a constant declaration's type annotation:
```ts
const foo: <S>(x: S) => boolean = <T>(y: T): boolean => { 
    const x: T = y; // type reference here
    return x === y; 
};
foo<number>(1);
// true
```

Nested function types:
```ts
const foo = <T>(x: T): <S>(y: S) => <R>(z: R) => T => { 
    function g<S>(y: S): <R>(z: R) => T {
        function h<R>(z: R) {
            return x;
        }
        return h;
    }
    return g; 
};
const f1 = foo<number>(1);
const f2 = f1<string>("hello");
f2<boolean>(true)
// 1
```

Multiple type parameters:
```ts
function f<T, P>(z: T): (x: T, y: P) => P { 
    const g: <R>(x: T, y: R) => R = <R>(x: T, y: R): R => y; 
    return g; 
}
const foo = f<number, string>(1); 
// Error: Expected (number, string) => string as return value, got <R>(number, type 'R') => type 'R'.
// f expects a non-generic function as return value.
```
```ts
function f<T, P>(z: T): (x: T, y: P) => P { 
    const g: <R>() => (x: T, y: R) => R = <R>(): (x: T, y: R) => R => (x: T, y: R): R => y; 
    return g<P>(); 
}
const foo = f<number, string>(1); 
// No error
// type of foo: (number, string) => string
foo(2, "hello");
// string: "hello"
```

### Any Type

The following programs contain type errors that would not be caught using static type checking:

```ts
const x = "hello"; 
function g(x: any): number {
  return f(x); // x is a string, but f expects a number
}
function f(x: number): number {
  return x + 1;
}
g(x);
// Error: Line 3: Expected number as argument 0, got string.
```
```ts
const x: any = 1;
x("hello");
// Error: Line 2: Expected function as callee, got number.
```

Parameter and return types without type annotations are inferred to have type `any`:
```ts
const getFromAPI = (params) => {
    return "My first movie"
}
// Can be called with any kind of value (and no type arguments, unlike generic functions)
getFromAPI(1);
getFromAPI("hello");
getFromAPI(x => x);
// No errors

// But the runtime value still contains type information,
// so assigning it to a number results in an error
const x: number = getFromAPI(1);
// Error: Expected number as type of x, got string.

const getNumberOfMovies = (name: string): number => {
    return getFromAPI(name); // returns a string
}
getNumberOfMovies("toy story") - 1;
// Error: Expected number as return value, got string.
```

Note that the last example is the same example from the [first section](#about-dynamic-typescript).
