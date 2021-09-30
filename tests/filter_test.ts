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

test('TestSimple', async () => {
    const typeInt32 = Gandiva.typeInt32();
    const typeBoolean = Gandiva.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 3, null, 6]),
        Arrow.Int32Vector.from([5, 9, null, 17, 3]),
    ], ["f0", "f1"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Int16())])));

    const schema = Gandiva.readerSchema(reader);
    const schemaOut = Gandiva.readerSchema(readerOut);

    const field0 = Gandiva.schemaFieldByName(schema, "f0");
    const field1 = Gandiva.schemaFieldByName(schema, "f1");
    const nodeF0 = Gandiva.makeField(field0);
    const nodeF1 = Gandiva.makeField(field1);

    const sumNodes = new Gandiva.NodeVector();
    sumNodes.push_back(nodeF0);
    sumNodes.push_back(nodeF1);
    const sumFunction = Gandiva.makeFunction("add", sumNodes, typeInt32);
    const literal10 = Gandiva.makeLiteralInt32(10);
    const lessThanNodes = new Gandiva.NodeVector();
    lessThanNodes.push_back(sumFunction);
    lessThanNodes.push_back(literal10);
    const lessThan10 = Gandiva.makeFunction("less_than", lessThanNodes, typeBoolean);
    const condition = Gandiva.makeCondition(lessThan10);
    const filter = Gandiva.makeFilter(schema, condition);

    const result = [];

    for (let i = 0; i < Gandiva.readerNumRecordBatches(reader); i++) {
        const batch = Gandiva.readerReadRecordBatch(reader, i);
        const numRows = Gandiva.batchNumRows(batch);
        const selectionVector = Gandiva.selectionVectorMakeInt16(numRows);
        Gandiva.filterEvaluate(filter, selectionVector, batch);
        const buffer = Gandiva.selectionVectorToBuffer(selectionVector, schemaOut);
        const bufferView = Gandiva.bufferView(buffer);
        const table = Arrow.Table.from(bufferView);
        result.push(JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString()));
    }

    expect(result).toHaveLength(1);
    expect(result[0].batches).toHaveLength(1);
    expect(result[0].batches[0].count).toBe(2);
    expect(result[0].batches[0].columns).toHaveLength(1);
    expect(result[0].batches[0].columns[0].count).toBe(2);
    expect(result[0].batches[0].columns[0].DATA.slice(0, 2)).toEqual([0, 4]);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 2)).toEqual([1, 1]);
});
