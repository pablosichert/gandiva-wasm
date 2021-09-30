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

test('TestTime', async () => {
    function millisInDay(hh, mm, ss, millis) {
        const mins = hh * 60 + mm;
        const secs = mins * 60 + ss;

        return secs * 1000 + millis;
    }

    const reader = await makeReader(Arrow.Table.new([
        Arrow.DateMillisecondVector.from([
            millisInDay(5, 35, 25, 0),
            millisInDay(0, 59, 0, 0),
            millisInDay(12, 30, 0, 0),
            millisInDay(23, 0, 0, 0)
        ]),
    ], ["f0"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([
        Arrow.Field.new("mm", new Arrow.Int64()),
        Arrow.Field.new("hh", new Arrow.Int64())
    ])));

    const schema = Gandiva.readerSchema(reader);
    const schemaOut = Gandiva.readerSchema(readerOut);

    const field0 = Gandiva.schemaFieldByName(schema, "f0");
    const fieldMinute = Gandiva.schemaFieldByName(schemaOut, "mm");
    const fieldHour = Gandiva.schemaFieldByName(schemaOut, "hh");

    const time2MinuteExpressionFields = new Gandiva.FieldVector();
    time2MinuteExpressionFields.push_back(field0);
    const time2MinuteExpression = Gandiva.makeFunctionExpression("extractMinute", time2MinuteExpressionFields, fieldMinute);

    const time2HourExpressionFields = new Gandiva.FieldVector();
    time2HourExpressionFields.push_back(field0);
    const time2HourExpression = Gandiva.makeFunctionExpression("extractHour", time2HourExpressionFields, fieldHour);

    const expressionVector = new Gandiva.ExpressionVector();
    expressionVector.push_back(time2MinuteExpression);
    expressionVector.push_back(time2HourExpression);
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
    expect(result[0].batches[0].columns[0].DATA.slice(0, 4)).toEqual(["35", "59", "30", "0"]);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(result[0].batches[0].columns[1].count).toBe(4);
    expect(result[0].batches[0].columns[1].DATA.slice(0, 4)).toEqual(["5", "0", "12", "23"]);
    expect(result[0].batches[0].columns[1].VALIDITY.slice(0, 4)).toEqual([1, 1, 1, 1]);
});
