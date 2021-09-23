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

test('TestSimple', async () => {
    const typeInt32 = Module.typeInt32();
    const typeBoolean = Module.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 3, null, 6]),
        Arrow.Int32Vector.from([5, 9, null, 17, 3]),
    ], ["f0", "f1"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Int16())])));

    const schema = Module.readerSchema(reader);
    const schemaOut = Module.readerSchema(readerOut);

    const field0 = Module.schemaFieldByName(schema, "f0");
    const field1 = Module.schemaFieldByName(schema, "f1");
    const nodeF0 = Module.makeField(field0);
    const nodeF1 = Module.makeField(field1);

    const sumNodes = new Module.NodeVector();
    sumNodes.push_back(nodeF0);
    sumNodes.push_back(nodeF1);
    const sumFunction = Module.makeFunction("add", sumNodes, typeInt32);
    const literal10 = Module.makeLiteralInt32(10);
    const lessThanNodes = new Module.NodeVector();
    lessThanNodes.push_back(sumFunction);
    lessThanNodes.push_back(literal10);
    const lessThan10 = Module.makeFunction("less_than", lessThanNodes, typeBoolean);
    const condition = Module.makeCondition(lessThan10);
    const filter = Module.makeFilter(schema, condition);

    const result = [];

    for (let i = 0; i < Module.readerNumRecordBatches(reader); i++) {
        const batch = Module.readerReadRecordBatch(reader, i);
        const numRows = Module.batchNumRows(batch);
        const selectionVector = Module.selectionVectorMakeInt16(numRows);
        Module.filterEvaluate(filter, selectionVector, batch);
        const buffer = Module.selectionVectorToBuffer(selectionVector, schemaOut);
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
                            "bitWidth": 16,
                            "isSigned": true
                        },
                        "children": []
                    }
                ]
            },
            "batches": [
                {
                    "count": 2,
                    "columns": [
                        {
                            "name": "result",
                            "count": 2,
                            "VALIDITY": [
                                1,
                                1
                            ],
                            "DATA": [
                                0,
                                4,
                                17984,
                                40,
                                0
                            ]
                        }
                    ]
                }
            ]
        }
    ]);
});