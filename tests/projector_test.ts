import path from "path";
import wasmModule from "../dist/gandiva.node.js";
import * as Arrow from "apache-arrow";

async function makeReader(table) {
    const writer = Arrow.RecordBatchFileWriter.writeAll(table);
    const buffer = await writer.toUint8Array();
    return Module.makeReader(buffer);
}

let Module;

beforeAll(async () => {
    console.warn = () => { };

    Module = await wasmModule({
        locateFile: (file: string) => path.join(__dirname, "..", "dist", file),
    });
});

test('TestIntSumSub', async () => {
    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 3, null]),
        Arrow.Int32Vector.from([11, 13, null, 17]),
    ], ["f0", "f1"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([
        Arrow.Field.new("add", new Arrow.Int32()),
        Arrow.Field.new("subtract", new Arrow.Int32())
    ])));

    const schema = Module.readerSchema(reader);
    const schemaOut = Module.readerSchema(readerOut);

    const field0 = Module.schemaFieldByName(schema, "f0");
    const field1 = Module.schemaFieldByName(schema, "f1");
    const fieldSum = Module.schemaFieldByName(schemaOut, "add");
    const fieldSub = Module.schemaFieldByName(schemaOut, "subtract");

    const sumExpressionFields = new Module.FieldVector();
    sumExpressionFields.push_back(field0);
    sumExpressionFields.push_back(field1);
    const sumExpression = Module.makeFunctionExpression("add", sumExpressionFields, fieldSum);

    const subExpressionFields = new Module.FieldVector();
    subExpressionFields.push_back(field0);
    subExpressionFields.push_back(field1);
    const subExpression = Module.makeFunctionExpression("subtract", subExpressionFields, fieldSub);

    const expressionVector = new Module.ExpressionVector();
    expressionVector.push_back(sumExpression);
    expressionVector.push_back(subExpression);
    const projector = Module.makeProjector(schema, expressionVector);

    const result = [];

    for (let i = 0; i < Module.readerNumRecordBatches(reader); i++) {
        const batch = Module.readerReadRecordBatch(reader, i);
        const arrayVector = Module.projectorEvaluate(projector, batch);
        const buffer = Module.arrayVectorToBuffer(arrayVector, schemaOut);
        const bufferView = Module.bufferView(buffer);
        const table = Arrow.Table.from(bufferView);
        result.push(JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString()));
    }

    expect(result).toStrictEqual([{
        "schema": {
            "fields": [
                {
                    "name": "add",
                    "nullable": false,
                    "type": {
                        "name": "int",
                        "bitWidth": 32,
                        "isSigned": true
                    },
                    "children": []
                },
                {
                    "name": "subtract",
                    "nullable": false,
                    "type": {
                        "name": "int",
                        "bitWidth": 32,
                        "isSigned": true
                    },
                    "children": []
                }
            ]
        },
        "batches": [
            {
                "count": 4,
                "columns": [
                    {
                        "name": "add",
                        "count": 4,
                        "VALIDITY": [
                            1,
                            1,
                            0,
                            0
                        ],
                        "DATA": [
                            12,
                            15,
                            3,
                            17
                        ]
                    },
                    {
                        "name": "subtract",
                        "count": 4,
                        "VALIDITY": [
                            1,
                            1,
                            0,
                            0
                        ],
                        "DATA": [
                            -10,
                            -11,
                            3,
                            -17
                        ]
                    }
                ]
            }
        ]
    }]);
});
