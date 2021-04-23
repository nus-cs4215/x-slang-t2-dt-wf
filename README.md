Overview
=====
Welcome to the Dynamic TypeScript!

Dynamic TypeScript is a variant of TypeScript that uses TypeScript syntax with dynamic type checking. Its language features are similar to Source §1, but with type annotations. Our project comprises of two components, x-slang and x-frontend. The playground provides detail information when error occurs for better debugging experiences.

Source§1 is documented here: <https://sicp.comp.nus.edu.sg/source/>
Dynamic TypeScript is documented here: <>

About Dynamic TypeScript
=====
The native TypeScript compiler performs static type checking and type inference before compiling the program into Javascript. If there are any type errors, they are found and reported to the programmer at this stage. The compiled program can then be executed, for example by the browser. However the generated JavaScript program does not know anything about the types. 

By using the native TypeScript compiler, we would need to fix all type errors first. We could just annotate stuff with the type ‘any’ which will be able to bypass its static type checks and if something goes wrong and we will eventually end up with uninformative errors like “Calling non-function value”. 

In a real-world context, static type checking can also be insufficient when calling external APIs or when unserialising data. 

```ts
const getFromAPI = (params:string):any => {
    return "My First Movie"
}
const getNumberOfMovies = (name:string):number => {
    return getFromAPI(name)
}

getNumberOfMovies("Toy Story") - 1;

[LOG]: NaN
```

In the example we provided above, we are trying get the number of movies by calling an external API. We expect the api to return a number but instead it returns a string, so when we try to minus a number from the string, it simply gets evaluated to “not a number”. Imagine this happened in a large-scale program — it would be very hard to debug this error based on the output. This it the reason why we decide to develop the Dynamic TypeScript inorder to help the programmers to quickly located the errors during runtime.

Syntax Validation - Parsing TypeScript
=====
We use babel/Parser APIs to handle our syntax validation process i.e., AST generation. This process allows the user program to be checked and error messages can be returned to the user, if any.

@babel/parser
The Babel parser (previously Babylon) is a JavaScript parser used in Babel.

1.The latest ECMAScript version enabled by default (ES2020).\
2.Comment attachment.\
3.Support for JSX, Flow, Typescript.\
4.Support for experimental language proposals (accepting PRs for anything at least stage-0).\

@babel/parser is documented here: <https://babeljs.io/docs/en/babel-parser>


Dynamic Type Checking 
=====

For dynamic type checking, types are checked at execution time.  Each runtime object has a type tag containing its type information. 

```ts
(1, number) + (2, number) ⇒ (3, number)
(1, number) + (“hello”, string) ⇒ TypeError
```

During runtime, if we add two numbers it will return a number , else if we add a string to a number it will return a type error. We will be able to know where exactly the program goes wrong by looking at the TypeError.


Scope & Syntax
=====
1.Literals, primitive operators, conditional expressions

```ts
(1 < 2) ? “abc” : “xyz”;
```

2.Constant declarations
```ts
const x: number = 1;
```
Note: for name declaration, type annotations are optional.

3.Function declarations, function calls (including higher-order functions)
```ts
const foo = (x: number): boolean => x < 1;
function goo(x: number): (y: number) => number { 
    return (y: number): number => x; 
}
```
Note: Type Annotations are required for parameter and return types in our language.

4.Generic functions and generic (polymorphic) types 
```ts
const id: <T>(x: T) => T = <T>(x: T): T => x;

id<number>(1); 
id<string>(“hello”);
```
Note: Type Argument are compulsory but unlike Source, semi-colons are not required due to babel parser’s limitations. 



## Example Programs

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


```ts
function f<T>(x: T): T { 
    return x; 
}
const g: <S>(y: S) => S = f;

f<number>(1);
f<string>("hello");
```

```ts
function f<T>(x: <S>(y: S) => S, y: T): T { 
    return x<T>(y); 
}

function g<R>(z: R): R { 
    return z; 
}
f<number>(g, 1);

const y: (x: string) => boolean = 
    f<(x: string) => boolean>(g, (y: string): boolean => y < 'hello');
y('abcde');
y('world');

// The following produce errors
f<number>((x: number): number => x < 0 ? 0 : x, -1)
function f<T>(x: <S>(y: S) => S, y: S): T { 
    return x<T>(y); 
}
function f<T>(x: <S>(y: S) => (z: T) => R, y: T): T { 
    return x<T>(y); 
}
```

```ts
const foo: <S>(x: S) => boolean = <T>(y: T): boolean => { 
    const x: T = y; 
    return x === y; 
};
foo<number>(1);
```

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
```

```ts
const goo = <T>(f: (z: T) => T, y: T): T => { 
    return f(y); 
};
goo<number>((x: number): number => x + 1, 2);
```

```ts
function f<T, P>(z: T): (x: T, y: P) => P { 
    const g: <R>(x: T, y: R) => R = <R>(x: T, y: R): R => y; 
    return g; 
}
const foo = f<number, string>(1); 
// Error: Expected (number, string) => string as return value, got (number, type 'R') => type 'R'.

function f<T, P>(z: T): (x: T, y: P) => P { 
    const g: <R>() => (x: T, y: R) => R = <R>(): (x: T, y: R) => R => (x: T, y: R): R => y; 
    return g<P>(); 
}
const foo = f<number, string>(1); 
// type of foo: (number, string) => string
foo(2, "hello");
// string: "hello"
```

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

The Makefile is there to help you build and run the program. Simply key in 
``` {.}
make ts
```
will run the program automatically.

``` {.}
ts:
	yarn tsc && node dist/repl/repl.js --variant=typescript

run:
	node dist/repl/repl.js --variant=typescript
```


If you do not wish to add \"x-slang\" to your PATH, replace
\"x-slang\" with \"node dist/repl/repl.js\ --variant=typescript" in the following examples.

To try out *Source* in a REPL, run

``` {.}
$ x-slang '1 * 1'
```


Testing
=======
`x-slang` comes with an extensive test suite. To run the tests after you made your modifications, run 
`yarn test`. Regression tests are run automatically when you want to push changes to this repository. 
The regression tests are generated using `jest` and stored as snapshots in `src/\_\_tests\_\_`.  After modifying `x-slang`, carefully inspect any failing regression tests reported in red in the command line. If you are convinced that the regression tests and not your changes are at fault, you can update the regression tests as follows:  
``` {.}
$ yarn test -- --updateSnapshot
```

Error messages
==============

To enable verbose messages, have the statement `"enable verbose";` as the first line of your program.

There are two main kinds of error messages: those that occur at runtime
and those that occur at parse time. The first can be found in
`interpreter-errors.ts`, while the second can be found in `rules/`.

Each error subclass will have `explain()` and `elaborate()`. Displaying the
error will always cause the first to be called; the second is only
called when verbose mode is enabled. As such, `explain()` should be made
to return a string containing the most basic information about what the
error entails. Any additional details about the error message, including
specifics and correction guides, should be left to `elaborate()`.

Please remember to write test cases to reflect your added
functionalities. The god of this repository is self-professed to be very
particular about test cases.

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
You can find the slides from here <https://docs.google.com/presentation/d/1XfzG18aVm5IXMWypXlmBllvWFPOVmQaDfQXkMBRY2YA/edit?usp=sharing>
