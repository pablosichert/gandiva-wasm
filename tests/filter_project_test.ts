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

test('TestSimple16', async () => {
    const typeBoolean = Gandiva.typeBoolean();

    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 6, 40, 3]),
        Arrow.Int32Vector.from([5, 9, 3, 17, 6]),
        Arrow.Int32Vector.from([1, 2, 6, 40, null]),
    ], ["f0", "f1", "f2"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.Int32())])));

    const schema = Gandiva.readerSchema(reader);
    const schemaOut = Gandiva.readerSchema(readerOut);

    const field0 = Gandiva.schemaFieldByName(schema, "f0");
    const field1 = Gandiva.schemaFieldByName(schema, "f1");
    const field2 = Gandiva.schemaFieldByName(schema, "f2");
    const fieldResult = Gandiva.schemaFieldByName(schemaOut, "result");
    const nodeF0 = Gandiva.makeField(field0);
    const nodeF1 = Gandiva.makeField(field1);

    const lessThanNodes = new Gandiva.NodeVector();
    lessThanNodes.push_back(nodeF0);
    lessThanNodes.push_back(nodeF1);
    const lessThanFunction = Gandiva.makeFunction("less_than", lessThanNodes, typeBoolean);
    const condition = Gandiva.makeCondition(lessThanFunction);
    const sumFields = new Gandiva.FieldVector();
    sumFields.push_back(field1);
    sumFields.push_back(field2);
    const sumExpression = Gandiva.makeFunctionExpression("add", sumFields, fieldResult);
    const filter = Gandiva.makeFilter(schema, condition);
    const projectorExpressions = new Gandiva.ExpressionVector();
    projectorExpressions.push_back(sumExpression);
    const projector = Gandiva.makeProjectorWithSelectionVectorMode(schema, projectorExpressions, Gandiva.SelectionVectorMode.UINT16);

    const result = [];

    for (let i = 0; i < Gandiva.readerNumRecordBatches(reader); i++) {
        const batch = Gandiva.readerReadRecordBatch(reader, i);
        const numRows = Gandiva.batchNumRows(batch);
        const selectionVector = Gandiva.selectionVectorMakeInt16(numRows);
        Gandiva.filterEvaluate(filter, selectionVector, batch);
        const arrayVector = Gandiva.projectorEvaluateWithSelectionVector(projector, selectionVector, batch);
        const buffer = Gandiva.arrayVectorToBuffer(arrayVector, schemaOut);
        const bufferView = Gandiva.bufferView(buffer);
        const table = Arrow.Table.from(bufferView);
        result.push(JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString()));
    }

    expect(result).toHaveLength(1);
    expect(result[0].batches).toHaveLength(1);
    expect(result[0].batches[0].count).toBe(3);
    expect(result[0].batches[0].columns).toHaveLength(1);
    expect(result[0].batches[0].columns[0].count).toBe(3);
    expect(result[0].batches[0].columns[0].DATA[0]).toEqual(6);
    expect(result[0].batches[0].columns[0].DATA[1]).toEqual(11);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 3)).toEqual([1, 1, 0]);
});
