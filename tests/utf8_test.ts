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

test('TestLike', async () => {
    const typeBoolean = Module.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Utf8Vector.from(["park", "sparkle", "bright spark and fire", "spark"]),
    ], ["a"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Bool())])));

    const schema = Module.readerSchema(reader);
    const schemaOut = Module.readerSchema(readerOut);

    const fieldA = Module.schemaFieldByName(schema, "a");
    const fieldResult = Module.schemaFieldByName(schemaOut, "result");

    const nodeA = Module.makeField(fieldA);
    const literalS = Module.makeStringLiteral("%spark%");
    const isLikeNodes = new Module.NodeVector();
    isLikeNodes.push_back(nodeA);
    isLikeNodes.push_back(literalS);
    const isLike = Module.makeFunction("like", isLikeNodes, typeBoolean);
    const expression = Module.makeExpression(isLike, fieldResult);
    const expressionVector = new Module.ExpressionVector();
    expressionVector.push_back(expression);
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

    expect(result).toStrictEqual([
        {
            "schema": {
                "fields": [
                    {
                        "name": "result",
                        "nullable": false,
                        "type": {
                            "name": "bool"
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
                            "name": "result",
                            "count": 4,
                            "VALIDITY": [
                                1,
                                1,
                                1,
                                1
                            ],
                            "DATA": [
                                false,
                                true,
                                true,
                                true
                            ]
                        }
                    ]
                }
            ]
        }
    ]);
});