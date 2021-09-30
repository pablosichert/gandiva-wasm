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

test('TestIntSumSub', async () => {
    const reader = await makeReader(Arrow.Table.new([
        Arrow.Int32Vector.from([1, 2, 3, null]),
        Arrow.Int32Vector.from([11, 13, null, 17]),
    ], ["f0", "f1"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([
        Arrow.Field.new("add", new Arrow.Int32()),
        Arrow.Field.new("subtract", new Arrow.Int32())
    ])));

    const schema = Gandiva.readerSchema(reader);
    const schemaOut = Gandiva.readerSchema(readerOut);

    const field0 = Gandiva.schemaFieldByName(schema, "f0");
    const field1 = Gandiva.schemaFieldByName(schema, "f1");
    const fieldSum = Gandiva.schemaFieldByName(schemaOut, "add");
    const fieldSub = Gandiva.schemaFieldByName(schemaOut, "subtract");

    const sumExpressionFields = new Gandiva.FieldVector();
    sumExpressionFields.push_back(field0);
    sumExpressionFields.push_back(field1);
    const sumExpression = Gandiva.makeFunctionExpression("add", sumExpressionFields, fieldSum);

    const subExpressionFields = new Gandiva.FieldVector();
    subExpressionFields.push_back(field0);
    subExpressionFields.push_back(field1);
    const subExpression = Gandiva.makeFunctionExpression("subtract", subExpressionFields, fieldSub);

    const expressionVector = new Gandiva.ExpressionVector();
    expressionVector.push_back(sumExpression);
    expressionVector.push_back(subExpression);
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
    expect(result[0].batches[0].columns).toHaveLength(2);
    expect(result[0].batches[0].columns[0].count).toBe(4);
    expect(result[0].batches[0].columns[0].DATA[0]).toBe(12);
    expect(result[0].batches[0].columns[0].DATA[1]).toBe(15);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(result[0].batches[0].columns[1].count).toBe(4);
    expect(result[0].batches[0].columns[1].DATA[0]).toBe(-10);
    expect(result[0].batches[0].columns[1].DATA[1]).toBe(-11);
    expect(result[0].batches[0].columns[1].VALIDITY.slice(0, 4)).toEqual([1, 1, 0, 0]);
});
