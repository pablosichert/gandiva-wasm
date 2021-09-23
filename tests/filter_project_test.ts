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

test('TestSimple16', async () => {
    const typeBoolean = Module.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 6, 40, 3]),
        Arrow.Int32Vector.from([5, 9, 3, 17, 6]),
        Arrow.Int32Vector.from([1, 2, 6, 40, null]),
    ], ["f0", "f1", "f2"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Int32())])));

    const schema = Module.readerSchema(reader);
    const schemaOut = Module.readerSchema(readerOut);

    const field0 = Module.schemaFieldByName(schema, "f0");
    const field1 = Module.schemaFieldByName(schema, "f1");
    const field2 = Module.schemaFieldByName(schema, "f2");
    const fieldResult = Module.schemaFieldByName(schemaOut, "result");
    const nodeF0 = Module.makeField(field0);
    const nodeF1 = Module.makeField(field1);

    const lessThanNodes = new Module.NodeVector();
    lessThanNodes.push_back(nodeF0);
    lessThanNodes.push_back(nodeF1);
    const lessThanFunction = Module.makeFunction("less_than", lessThanNodes, typeBoolean);
    const condition = Module.makeCondition(lessThanFunction);
    const sumFields = new Module.FieldVector();
    sumFields.push_back(field1);
    sumFields.push_back(field2);
    const sumExpression = Module.makeFunctionExpression("add", sumFields, fieldResult);
    const filter = Module.makeFilter(schema, condition);
    const projectorExpressions = new Module.ExpressionVector();
    projectorExpressions.push_back(sumExpression);
    const projector = Module.makeProjectorWithSelectionVectorMode(schema, projectorExpressions, Module.SelectionVectorMode.UINT16);

    const result = [];

    for (let i = 0; i < Module.readerNumRecordBatches(reader); i++) {
        const batch = Module.readerReadRecordBatch(reader, i);
        const numRows = Module.batchNumRows(batch);
        const selectionVector = Module.selectionVectorMakeInt16(numRows);
        Module.filterEvaluate(filter, selectionVector, batch);
        const arrayVector = Module.projectorEvaluateWithSelectionVector(projector, selectionVector, batch);
        const buffer = Module.arrayVectorToBuffer(arrayVector, schemaOut);
        const bufferView = Module.bufferView(buffer);
        const table = Arrow.Table.from(bufferView);
        result.push(JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString()));
    }

    expect(result).toStrictEqual([
        {
            "schema": {
                "fields": [
                    {
                        "name": "result",
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
                    "count": 3,
                    "columns": [
                        {
                            "name": "result",
                            "count": 3,
                            "VALIDITY": [
                                1,
                                1,
                                0
                            ],
                            "DATA": [
                                6,
                                11,
                                6
                            ]
                        }
                    ]
                }
            ]
        }
    ]);
});