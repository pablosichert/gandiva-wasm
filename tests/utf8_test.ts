import path from "path";
import wasmModule from "../dist/gandiva.node.js";
import * as Arrow from "apache-arrow";

async function makeReader(table) {
    const writer = Arrow.RecordBatchFileWriter.writeAll(table);
    const buffer = await writer.toUint8Array();
    return Gandiva.makeReader(buffer);
}

let Gandiva;

beforeAll(async () => {
    console.warn = () => { };

    Gandiva = await wasmModule({
        locateFile: (file: string) => path.join(__dirname, "..", "dist", file),
    });
});

test('TestLike', async () => {
    const typeBoolean = Gandiva.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Utf8Vector.from(["park", "sparkle", "bright spark and fire", "spark"]),
    ], ["a"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Bool())])));

    const schema = Gandiva.readerSchema(reader);
    const schemaOut = Gandiva.readerSchema(readerOut);

    const fieldA = Gandiva.schemaFieldByName(schema, "a");
    const fieldResult = Gandiva.schemaFieldByName(schemaOut, "result");

    const nodeA = Gandiva.makeField(fieldA);
    const literalS = Gandiva.makeLiteralString("%spark%");
    const isLikeNodes = new Gandiva.NodeVector();
    isLikeNodes.push_back(nodeA);
    isLikeNodes.push_back(literalS);
    const isLike = Gandiva.makeFunction("like", isLikeNodes, typeBoolean);
    const expression = Gandiva.makeExpression(isLike, fieldResult);
    const expressionVector = new Gandiva.ExpressionVector();
    expressionVector.push_back(expression);
    const projector = Gandiva.makeProjector(schema, expressionVector);

    const result = [];

    for (let i = 0; i < Gandiva.readerNumRecordBatches(reader); i++) {
        const batch = Gandiva.readerReadRecordBatch(reader, i);
        const arrayVector = Gandiva.projectorEvaluate(projector, batch);
        const buffer = Gandiva.arrayVectorToBuffer(arrayVector, schemaOut);
        const bufferView = Gandiva.bufferView(buffer);
        const table = Arrow.Table.from(bufferView);
        result.push(JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString()));
    }

    expect(result).toHaveLength(1);
    expect(result[0].batches).toHaveLength(1);
    expect(result[0].batches[0].count).toBe(4);
    expect(result[0].batches[0].columns).toHaveLength(1);
    expect(result[0].batches[0].columns[0].count).toBe(4);
    expect(result[0].batches[0].columns[0].DATA.slice(0, 4)).toEqual([false, true, true, true]);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 4)).toEqual([1, 1, 1, 1]);
});
