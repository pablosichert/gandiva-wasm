export type Expression = undefined | UnOp | BinOp | TypedLiteral | Literal;

export type Field =
    | undefined
    | {
          name: string;
          expression: Expression;
          type:
              | "UInt8"
              | "UInt16"
              | "UInt32"
              | "UInt64"
              | "Int8"
              | "Int16"
              | "Int32"
              | "Int64"
              | "Float"
              | "Double"
              | "String";
      };

export type UnOp = NotExpression;

export type NotExpression = {
    type: "!";
    expression: Expression;
};

export type BinOp =
    | AndExpression
    | OrExpression
    | GreaterExpression
    | GreaterEqualExpression
    | EqualExpression
    | NotEqualExpression
    | LessEqualExpression
    | LessExpression;

export type AndExpression = {
    type: "&&";
    left: Expression;
    right: Expression;
};

export type OrExpression = {
    type: "||";
    left: Expression;
    right: Expression;
};

export type GreaterExpression = {
    type: ">";
    left: Expression;
    right: Expression;
};

export type GreaterEqualExpression = {
    type: ">=";
    left: Expression;
    right: Expression;
};

export type EqualExpression = {
    type: "==";
    left: Expression;
    right: Expression;
};

export type NotEqualExpression = {
    type: "!=";
    left: Expression;
    right: Expression;
};

export type LessEqualExpression = {
    type: "<=";
    left: Expression;
    right: Expression;
};

export type LessExpression = {
    type: "<";
    left: Expression;
    right: Expression;
};

export type TypedLiteral =
    | UInt8Literal
    | UInt16Literal
    | UInt32Literal
    | UInt64Literal
    | Int8Literal
    | Int16Literal
    | Int32Literal
    | Int64Literal
    | FloatLiteral
    | DoubleLiteral
    | StringLiteral;

export type UInt8Literal = {
    type: "UInt8";
    literal: string;
};

export type UInt16Literal = {
    type: "UInt16";
    literal: string;
};

export type UInt32Literal = {
    type: "UInt32";
    literal: string;
};

export type UInt64Literal = {
    type: "UInt64";
    literal: string;
};

export type Int8Literal = {
    type: "Int8";
    literal: string;
};

export type Int16Literal = {
    type: "Int16";
    literal: string;
};

export type Int32Literal = {
    type: "Int32";
    literal: string;
};

export type Int64Literal = {
    type: "Int64";
    literal: string;
};

export type FloatLiteral = {
    type: "Float";
    literal: string;
};

export type DoubleLiteral = {
    type: "Double";
    literal: string;
};

export type StringLiteral = {
    type: "String";
    literal: string;
};

export type Literal = {
    type: "literal";
    literal: string;
};
