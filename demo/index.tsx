import React from "react";
import ReactDOM from "react-dom";
import wasmModule from "gandiva-wasm";
import * as expressions from "./expression";
import * as styles from "./styles.module.css";
import * as Arrow from "apache-arrow";
import randomLogs from "./randomLogs";

var Gandiva;
var typeBoolean;
var resolveReady;
var ready = new Promise((resolve) => (resolveReady = resolve));

(async () => {
    Gandiva = await wasmModule();
    (window as any).Gandiva = Gandiva;
    resolveReady();

    Gandiva.setCacheCapacity(0);

    typeBoolean = Gandiva.typeBoolean();
})();

async function makeReader(table) {
    const writer = Arrow.RecordBatchFileWriter.writeAll(table);
    const buffer = await writer.toUint8Array();
    return Gandiva.makeReader(buffer);
}

function compileExpression(schema: any, expression: expressions.Expression) {
    if (!expression) {
        return null;
    }

    switch (expression.type) {
        case "&&":
        case "||": {
            const makeNode = (() => {
                switch (expression.type) {
                    case "&&":
                        return Gandiva.makeAnd;
                    case "||":
                        return Gandiva.makeOr;
                }
            })();

            const left = compileExpression(schema, expression.left);
            const right = compileExpression(schema, expression.right);
            const nodes = new Gandiva.NodeVector();
            nodes.push_back(left);
            nodes.push_back(right);
            return makeNode(nodes);
        }
        case "!": {
            const inner = compileExpression(schema, expression.expression);
            const nodes = new Gandiva.NodeVector();
            nodes.push_back(inner);
            return Gandiva.makeFunction("not", nodes, typeBoolean);
        }
        case ">":
        case ">=":
        case "==":
        case "<=":
        case "<": {
            const operation = (() => {
                switch (expression.type) {
                    case ">":
                        return "greater_than";
                    case ">=":
                        return "greater_than_or_equal_to";
                    case "==":
                        return "equal";
                    case "<=":
                        return "less_than_or_equal_to";
                    case "<":
                        return "less_than";
                }
            })();

            const left = compileExpression(schema, expression.left);
            const right = compileExpression(schema, expression.right);
            const nodes = new Gandiva.NodeVector();
            nodes.push_back(left);
            nodes.push_back(right);
            return Gandiva.makeFunction(operation, nodes, typeBoolean);
        }
        case "UInt8": {
            return Gandiva.makeLiteralUInt8(parseInt(expression.literal));
        }
        case "UInt16": {
            return Gandiva.makeLiteralUInt16(parseInt(expression.literal));
        }
        case "UInt32": {
            return Gandiva.makeLiteralUInt32(parseInt(expression.literal));
        }
        case "UInt64": {
            return Gandiva.makeLiteralUInt64(parseInt(expression.literal));
        }
        case "Int8": {
            return Gandiva.makeLiteralInt8(parseInt(expression.literal));
        }
        case "Int16": {
            return Gandiva.makeLiteralInt16(parseInt(expression.literal));
        }
        case "Int32": {
            return Gandiva.makeLiteralInt32(parseInt(expression.literal));
        }
        case "Int64": {
            return Gandiva.makeLiteralInt64(parseInt(expression.literal));
        }
        case "Float": {
            return Gandiva.makeLiteralFloat(parseFloat(expression.literal));
        }
        case "Double": {
            return Gandiva.makeLiteralDouble(parseFloat(expression.literal));
        }
        case "String": {
            return Gandiva.makeLiteralString(expression.literal);
        }
        case "literal": {
            const fieldName = expression.literal;
            const field = Gandiva.schemaFieldByName(schema, fieldName);
            if (!field) {
                throw `Unknown field "${fieldName}"`;
            }
            return Gandiva.makeField(field);
        }
    }
}

function compileFilter(schema: any, expression: expressions.Expression) {
    const compiled = compileExpression(schema, expression);
    const condition = Gandiva.makeCondition(compiled);
    return Gandiva.makeFilter(schema, condition);
}

async function compileProjector(schema: any, fields: expressions.Field[]) {
    const arrowFields = fields
        .filter((field) => field)
        .map((field) =>
            Arrow.Field.new(
                field.name,
                (() => {
                    switch (field.type) {
                        case "UInt8": {
                            return new Arrow.Uint8();
                        }
                        case "UInt16": {
                            return new Arrow.Uint16();
                        }
                        case "UInt32": {
                            return new Arrow.Uint32();
                        }
                        case "UInt64": {
                            return new Arrow.Uint64();
                        }
                        case "Int8": {
                            return new Arrow.Int8();
                        }
                        case "Int16": {
                            return new Arrow.Int16();
                        }
                        case "Int32": {
                            return new Arrow.Int32();
                        }
                        case "Int64": {
                            return new Arrow.Int64();
                        }
                        case "Float": {
                            return new Arrow.Float32();
                        }
                        case "Double": {
                            return new Arrow.Float64();
                        }
                        case "String": {
                            return new Arrow.Utf8();
                        }
                    }
                })()
            )
        );
    const schemaOut = new Arrow.Schema(arrowFields);
    const schemaReader = await makeReader(Arrow.Table.empty(schemaOut));
    const schemaOutPtr = Gandiva.readerSchema(schemaReader);

    const expressions = new Gandiva.ExpressionVector();
    for (const field of fields) {
        if (!field) {
            continue;
        }
        const nodePtr = compileExpression(schema, field.expression);
        const fieldPtr = Gandiva.schemaFieldByName(schemaOutPtr, field.name);
        const expression = Gandiva.makeExpression(nodePtr, fieldPtr);
        expressions.push_back(expression);
    }

    const projector = Gandiva.makeProjectorWithSelectionVectorMode(
        schema,
        expressions,
        Gandiva.SelectionVectorMode.UINT32
    );

    return [projector, schemaOut, schemaOutPtr];
}

class App extends React.Component {
    state = {
        table: null,
        reader: null,
        schemaPtr: null,
        expression: null,
        fields: [null],
        filter: null,
        projector: null,
        schemaOut: null,
        schemaOutPtr: null,
        result: null,
    };

    async componentDidMount() {
        await ready;

        const dummyTable = Arrow.Table.new(
            [
                Arrow.Uint16Vector.from(randomLogs.map(({ status }) => status)),
                Arrow.Utf8Vector.from(randomLogs.map(({ request }) => request)),
                Arrow.Uint64Vector.from(
                    randomLogs.map(() =>
                        BigInt(
                            Math.floor((0.5 + Math.random() * 0.5) * Date.now())
                        )
                    )
                ),
                Arrow.Float64Vector.from(
                    randomLogs.map(() => (Math.random() * 100).toFixed(3))
                ),
            ],
            ["status", "request", "timestamp", "elapsed"]
        );

        const dummyReader = await makeReader(dummyTable);
        const dummySchema = Gandiva.readerSchema(dummyReader);

        this.setState({
            table: dummyTable,
            reader: dummyReader,
            schemaPtr: dummySchema,
        });
    }

    handleChangeFilterExpression = (expression: expressions.Expression) => {
        this.setState({
            expression,
        });
    };

    handleAddField = () => {
        this.setState({
            fields: [...this.state.fields, null],
        });
    };

    handleChangeField = (index: number, field: expressions.Field) => {
        const fields = [...this.state.fields];
        fields[index] = field;
        this.setState({
            fields,
        });
    };

    handleCompile = async () => {
        this.setState({
            filter: null,
            projector: null,
            schemaOut: null,
            schemaOutPtr: null,
        });

        const filter = compileFilter(
            this.state.schemaPtr,
            this.state.expression
        );
        const [projector, schemaOut, schemaOutPtr] = await compileProjector(
            this.state.schemaPtr,
            this.state.fields
        );

        this.setState({
            filter,
            projector,
            schemaOut,
            schemaOutPtr,
        });
    };

    handleEvaluate = async () => {
        this.setState({
            result: null,
        });

        const numRecordBatches = Gandiva.readerNumRecordBatches(
            this.state.reader
        );

        const batches = [];

        for (let i = 0; i < numRecordBatches; i++) {
            const batch = Gandiva.readerReadRecordBatch(this.state.reader, i);
            const numRows = Gandiva.batchNumRows(batch);
            const selectionVector = Gandiva.selectionVectorMakeInt32(numRows);
            Gandiva.filterEvaluate(this.state.filter, selectionVector, batch);
            const arrayVector = Gandiva.projectorEvaluateWithSelectionVector(
                this.state.projector,
                selectionVector,
                batch
            );
            const buffer = Gandiva.arrayVectorToBuffer(
                arrayVector,
                this.state.schemaOutPtr
            );
            const bufferView = Gandiva.bufferView(buffer);
            const table = Arrow.Table.from(bufferView);
            batches.push(table.chunks);
        }

        const table = new Arrow.Table(this.state.schemaOut, batches);

        this.setState({
            result: table,
        });
    };

    handleClearResult = () => {
        this.setState({
            result: null,
        });
    };

    handleClearFilter = () => {
        this.setState({
            expression: null,
        });
    };

    handleClearProjector = () => {
        this.setState(
            {
                fields: [],
            },
            () => {
                this.setState({
                    fields: [null],
                });
            }
        );
    };

    render() {
        return (
            <>
                <div className={styles.Expression}>
                    <span className={styles.OperationLabel}>filter:</span>
                    <div className={styles.Fragment}>
                        <Expression
                            expression={this.state.expression}
                            onChange={this.handleChangeFilterExpression}
                        />
                        <button
                            className={styles.Clear}
                            onClick={this.handleClearFilter}
                        >
                            ✕
                        </button>
                    </div>
                </div>
                <div className={styles.Expression}>
                    <span className={styles.OperationLabel}>map:</span>
                    {this.state.fields.map((field, index) => (
                        <Field
                            key={index}
                            index={index}
                            field={field}
                            onChange={this.handleChangeField}
                        />
                    ))}{" "}
                    <button onClick={this.handleAddField}>+</button>
                    <button
                        className={styles.Clear}
                        onClick={this.handleClearProjector}
                    >
                        ✕
                    </button>
                </div>
                <div className={styles.Actions}>
                    <button onClick={this.handleCompile}>compile</button>
                    <button
                        onClick={this.handleEvaluate}
                        disabled={
                            !this.state.filter ||
                            !this.state.projector ||
                            !this.state.schemaOut ||
                            !this.state.schemaOutPtr
                        }
                    >
                        evaluate
                    </button>
                    <button
                        onClick={this.handleClearResult}
                        disabled={!this.state.result}
                    >
                        clear
                    </button>
                </div>
                <div className={styles.Tables}>
                    <div className={styles.Table}>
                        <center>
                            Input count:{" "}
                            {(this.state.table && this.state.table.count()) ||
                                0}
                        </center>
                        {this.state.table && <Table table={this.state.table} />}
                    </div>
                    <div className={styles.Table}>
                        <center>
                            Output count:{" "}
                            {(this.state.result && this.state.result.count()) ||
                                0}
                        </center>
                        {this.state.result && (
                            <Table table={this.state.result} />
                        )}
                    </div>
                </div>
            </>
        );
    }
}

const expressionList = [
    {
        key: "!",
        label: "!a",
    },
    {
        key: "&&",
        label: "a && b",
    },
    {
        key: "||",
        label: "a || b",
    },
    {
        key: ">",
        label: "a > b",
    },
    {
        key: ">=",
        label: "a >= b",
    },
    {
        key: "==",
        label: "a == b",
    },
    {
        key: "<",
        label: "a < b",
    },
    {
        key: "<=",
        label: "a <= b",
    },
    {
        key: "UInt8",
        label: "UInt8",
    },
    {
        key: "UInt16",
        label: "UInt16",
    },
    {
        key: "UInt32",
        label: "UInt32",
    },
    {
        key: "UInt64",
        label: "UInt64",
    },
    {
        key: "Int8",
        label: "Int8",
    },
    {
        key: "Int16",
        label: "Int16",
    },
    {
        key: "Int32",
        label: "Int32",
    },
    {
        key: "Int64",
        label: "Int64",
    },
    {
        key: "Float",
        label: "Float",
    },
    {
        key: "Double",
        label: "Double",
    },
    {
        key: "String",
        label: "String",
    },
];

class Table extends React.Component {
    renderData = () => {
        const rows = [];
        let numRows = 0;

        for (const row of this.props.table) {
            if (numRows > 100) {
                break;
            }

            const json = row.toString();
            try {
                const data = JSON.parse(json);
                rows.push(
                    <tr key={numRows}>
                        {this.props.table.schema.fields.map((field) => (
                            <td key={field.name}>{data[field.name]}</td>
                        ))}
                    </tr>
                );
            } catch (error) {
                console.log(error, json);
            }

            numRows++;
        }

        return rows;
    };

    render() {
        return (
            <table>
                <thead>
                    <tr>
                        {this.props.table.schema.fields.map((field) => (
                            <td key={field.name}>
                                <span className={styles.ColumnName}>
                                    {'"'}
                                    {field.name}
                                    {'"'}
                                </span>
                                <br />
                                {"<"}
                                <span className={styles.ColumnType}>
                                    {field.type.toString()}
                                </span>
                                {">"}
                            </td>
                        ))}
                    </tr>
                </thead>
                <tbody>{this.renderData()}</tbody>
            </table>
        );
    }
}

type FieldProps = {
    index: number;
    field: expressions.Field;
    onChange: (index: number, expression: expressions.Field) => void;
};

class Field extends React.Component<FieldProps> {
    state = {
        typeFocused: false,
    };

    typeList = [
        { key: "UInt8", label: "UInt8" },
        { key: "UInt16", label: "UInt16" },
        { key: "UInt32", label: "UInt32" },
        { key: "UInt64", label: "UInt64" },
        { key: "Int8", label: "Int8" },
        { key: "Int16", label: "Int16" },
        { key: "Int32", label: "Int32" },
        { key: "Int64", label: "Int64" },
        { key: "Float", label: "Float" },
        { key: "Double", label: "Double" },
        { key: "String", label: "String" },
    ];

    handleFocusType = () => {
        this.setState({
            typeFocused: true,
        });
    };

    handleBlurType = () => {
        this.setState({
            typeFocused: false,
        });
    };

    handleInputColumnName: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.props.onChange(this.props.index, {
            ...this.props.field,
            name: event.target.innerText,
        });
    };

    handleChangeExpression = (expression: expressions.Expression) => {
        this.props.onChange(this.props.index, {
            ...this.props.field,
            expression,
        });
    };

    handleSelectType = (key: string) => {
        this.handleBlurType();
        this.props.onChange(this.props.index, {
            ...this.props.field,
            type: key,
        });
    };

    render() {
        return (
            <span className={styles.Field}>
                <span className={styles.ColumnTitle}>
                    <span className={styles.ColumnName}>
                        {'"'}
                        <span
                            className={styles.InputPlaceholder}
                            contentEditable
                            suppressContentEditableWarning
                            onInput={this.handleInputColumnName}
                        />
                        {'"'}
                    </span>
                    {"<"}
                    <span className={styles.Fragment + " " + styles.ColumnType}>
                        <span
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusType}
                            onBlur={this.handleBlurType}
                        >
                            {this.props.field && this.props.field.type}
                        </span>
                        {this.state.typeFocused && (
                            <Dropdown
                                list={this.typeList}
                                onSelect={this.handleSelectType}
                            />
                        )}
                    </span>
                    {">"}
                </span>
                <Expression
                    expression={this.props.field?.expression}
                    onChange={this.handleChangeExpression}
                />
            </span>
        );
    }
}

type ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class Expression extends React.Component<ExpressionProps> {
    state = {
        focused: false,
    };

    handleFocus = () => {
        this.setState({
            focused: true,
        });
    };

    handleBlur = () => {
        this.setState({
            focused: false,
        });
    };

    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.handleBlur();
        this.props.onChange({
            type: "literal",
            literal: event.target.innerText,
        });
    };

    handleSelect = (key: string) => {
        this.handleBlur();
        this.props.onChange({
            type: key,
        });
    };

    handleChange = (expression: expressions.Expression) => {
        this.props.onChange(expression);
    };

    renderExpression = () => {
        if (!this.props.expression) {
            return null;
        }

        switch (this.props.expression.type) {
            case "!":
                return (
                    <NotExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "&&":
                return (
                    <AndExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "||":
                return (
                    <OrExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case ">":
                return (
                    <GreaterExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case ">=":
                return (
                    <GreaterEqualExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "==":
                return (
                    <EqualExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "<=":
                return (
                    <LessEqualExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "<":
                return (
                    <LessExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "UInt8":
                return (
                    <UInt8Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "UInt16":
                return (
                    <UInt16Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "UInt32":
                return (
                    <UInt32Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "UInt64":
                return (
                    <UInt64Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Int8":
                return (
                    <Int8Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Int16":
                return (
                    <Int16Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Int32":
                return (
                    <Int32Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Int64":
                return (
                    <Int64Expression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Float":
                return (
                    <FloatExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "Double":
                return (
                    <DoubleExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
            case "String":
                return (
                    <StringExpression
                        expression={this.props.expression}
                        onChange={this.handleChange}
                    />
                );
        }
    };

    render() {
        return (
            <span className={styles.Fragment}>
                {!this.props.expression ||
                this.props.expression.type === "literal" ? (
                    <span
                        contentEditable
                        suppressContentEditableWarning
                        className={styles.InputPlaceholder}
                        tabIndex={-1}
                        onFocus={this.handleFocus}
                        onBlur={this.handleBlur}
                        onInput={this.handleInput}
                    />
                ) : (
                    this.renderExpression()
                )}
                {this.state.focused && (
                    <Dropdown
                        list={expressionList}
                        onSelect={this.handleSelect}
                    />
                )}
            </span>
        );
    }
}

type NotExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class NotExpression extends React.Component<NotExpressionProps> {
    handleChange = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            expression,
        });
    };

    render() {
        return (
            <>
                {"!("}
                <Expression
                    expression={this.props.expression.expression}
                    onChange={this.handleChange}
                />
                {")"}
            </>
        );
    }
}

type AndExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class AndExpression extends React.Component<AndExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"&& "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type OrExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class OrExpression extends React.Component<OrExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"|| "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type GreaterExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class GreaterExpression extends React.Component<GreaterExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"> "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type GreaterEqualExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class GreaterEqualExpression extends React.Component<GreaterEqualExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {">= "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type EqualExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class EqualExpression extends React.Component<EqualExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"== "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type LessEqualExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class LessEqualExpression extends React.Component<LessEqualExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"<= "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type LessExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class LessExpression extends React.Component<LessExpressionProps> {
    state = {
        focusLeft: false,
        focusRight: false,
    };

    handleFocusLeft = () => {
        this.setState({
            focusLeft: true,
        });
    };

    handleBlurLeft = () => {
        this.setState({
            focusLeft: false,
        });
    };

    handleFocusRight = () => {
        this.setState({
            focusRight: true,
        });
    };

    handleBlurRight = () => {
        this.setState({
            focusRight: false,
        });
    };

    handleInputLeft: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleInputRight: React.DOMAttributes<HTMLSpanElement>["onInput"] = (
        event
    ) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: "literal",
                literal: event.target.innerText,
            },
        });
    };

    handleSelectLeft = (key: string) => {
        this.handleBlurLeft();
        this.props.onChange({
            ...this.props.expression,
            left: {
                type: key,
            },
        });
    };

    handleSelectRight = (key: string) => {
        this.handleBlurRight();
        this.props.onChange({
            ...this.props.expression,
            right: {
                type: key,
            },
        });
    };

    handleChangeLeft = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            left: expression,
        });
    };

    handleChangeRight = (expression: expressions.Expression) => {
        this.props.onChange({
            ...this.props.expression,
            right: expression,
        });
    };

    render() {
        return (
            <>
                {"("}
                <span className={styles.Fragment}>
                    {!this.props.expression.left ||
                    this.props.expression.left.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusLeft}
                            onBlur={this.handleBlurLeft}
                            onInput={this.handleInputLeft}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.left}
                            onChange={this.handleChangeLeft}
                        />
                    )}
                    {this.state.focusLeft && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectLeft}
                        />
                    )}
                </span>{" "}
                {"< "}
                <span className={styles.Fragment}>
                    {!this.props.expression.right ||
                    this.props.expression.right.type === "literal" ? (
                        <span
                            contentEditable
                            suppressContentEditableWarning
                            className={styles.InputPlaceholder}
                            tabIndex={-1}
                            onFocus={this.handleFocusRight}
                            onBlur={this.handleBlurRight}
                            onInput={this.handleInputRight}
                        />
                    ) : (
                        <Expression
                            expression={this.props.expression.right}
                            onChange={this.handleChangeRight}
                        />
                    )}
                    {this.state.focusRight && (
                        <Dropdown
                            list={expressionList}
                            onSelect={this.handleSelectRight}
                        />
                    )}
                </span>
                {")"}
            </>
        );
    }
}

type UInt8ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class UInt8Expression extends React.Component<UInt8ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"UInt8("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type UInt16ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class UInt16Expression extends React.Component<UInt16ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"UInt16("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type UInt32ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class UInt32Expression extends React.Component<UInt32ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"UInt32("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type UInt64ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class UInt64Expression extends React.Component<UInt64ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"UInt64("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type Int8ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class Int8Expression extends React.Component<Int8ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Int8("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type Int16ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class Int16Expression extends React.Component<Int16ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Int16("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type Int32ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class Int32Expression extends React.Component<Int32ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Int32("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type Int64ExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class Int64Expression extends React.Component<Int64ExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Int64("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type FloatExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class FloatExpression extends React.Component<FloatExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Float("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type DoubleExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class DoubleExpression extends React.Component<DoubleExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"Double("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

type StringExpressionProps = {
    expression: expressions.Expression;
    onChange: (expression: expressions.Expression) => void;
};

class StringExpression extends React.Component<StringExpressionProps> {
    handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
        this.props.onChange({
            ...this.props.expression,
            literal: event.target.innerText,
        });
    };

    render() {
        return (
            <>
                {"String("}
                <span
                    contentEditable
                    suppressContentEditableWarning
                    className={styles.InputPlaceholder}
                    onInput={this.handleInput}
                />
                {")"}
            </>
        );
    }
}

// type LiteralExpressionProps = {
//     expression: expressions.Expression;
//     onChange: (expression: expressions.Expression) => void;
// };

// class LiteralExpression extends React.Component<LessExpressionProps> {
//     handleInput: React.DOMAttributes<HTMLSpanElement>["onInput"] = (event) => {
//         setTimeout(() => {
//             this.props.onChange({
//                 ...this.props.expression,
//                 literal: event.target.innerText,
//             });
//         }, 0);
//     };

//     render() {
//         return (
//             <span
//                 contentEditable
//                 suppressContentEditableWarning
//                 onInput={this.handleInput}
//             >
//                 {this.props.expression.literal}
//             </span>
//         );
//     }
// }

type DropdownProps = {
    list: {
        key: string;
        label: string;
    }[];
    onSelect: (key: string) => void;
};

class Dropdown extends React.Component<DropdownProps> {
    handleMouseDown: React.DOMAttributes<HTMLDivElement>["onMouseDown"] = (
        event
    ) => {
        event.preventDefault();
    };

    handleSelect: React.DOMAttributes<HTMLDivElement>["onClick"] = (event) => {
        this.props.onSelect(event.target.dataset.key);
    };

    render() {
        return (
            <div className={styles.Dropdown}>
                {this.props.list.map(({ key, label }) => (
                    <div
                        key={key}
                        data-key={key}
                        onClick={this.handleSelect}
                        onMouseDown={this.handleMouseDown}
                    >
                        {label}
                    </div>
                ))}
            </div>
        );
    }
}

ReactDOM.render(<App />, document.getElementById("root"));
