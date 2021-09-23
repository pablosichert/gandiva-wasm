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

test('TestCastTimestamp', async () => {
    const reader = await makeReader(Arrow.Table.new([
        Arrow.Utf8Vector.from([
            "1967-12-1",
            "2067-12-1",
            "7-12-1",
            "67-12-1",
            "067-12-1",
            "0067-12-1",
            "00067-12-1",
            "167-12-1",
            "1972-12-1",
            "72-12-1",
            "1972-12-1",
            "67-12-1",
            "67-1-1",
            "71-1-1",
            "2000-09-23 9:45:30",
            "2000-09-23 9:45:30.920",
            "2000-09-23 9:45:30.920 +08:00",
            "2000-09-23 9:45:30.920 -11:45",
            "65-03-04 00:20:40.920 +00:30",
            "1932-05-18 11:30:00.920 +11:30",
            "1857-02-11 20:31:40.920 -05:30",
            "2000-09-23 9:45:30.920 +08:00",
            "2000-09-23 0:00:00.000 +00:00",
            "2000-09-23 9:45:30.1",
            "2000-09-23 9:45:30",
            "2000-09-23 9:45:30.10",
            "2000-09-23 9:45:30",
            "2000-09-23 9:45:30.100",
            "2000-09-23 9:45:30"
        ]),
    ], ["f0"]));

    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([Arrow.Field.new("result", new Arrow.TimestampMillisecond())])));

    const schema = Module.readerSchema(reader);
    const schemaOut = Module.readerSchema(readerOut);

    const field0 = Module.schemaFieldByName(schema, "f0");
    const fieldResult = Module.schemaFieldByName(schemaOut, "result");

    const castTimestampExpressionFields = new Module.FieldVector();
    castTimestampExpressionFields.push_back(field0);
    const castTimestampExpression = Module.makeFunctionExpression("castTIMESTAMP", castTimestampExpressionFields, fieldResult);

    const expressionVector = new Module.ExpressionVector();
    expressionVector.push_back(castTimestampExpression);
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


    expect(result).toHaveLength(1);
    expect(result[0].batches).toHaveLength(1);
    expect(result[0].batches[0].count).toBe(29);
    expect(result[0].batches[0].columns).toHaveLength(1);
    expect(result[0].batches[0].columns[0].count).toBe(29);
    expect(result[0].batches[0].columns[0].DATA.slice(0, 29)).toEqual([
        "18446744007872751616",
        "3089923200000",
        "1196467200000",
        "3089923200000",
        "3089923200000",
        "18446684049728751616",
        "18446684049728751616",
        "18446687205402351616",
        "92016000000",
        "92016000000",
        "92016000000",
        "3089923200000",
        "3061065600000",
        "31536000000",
        "969702330000",
        "969702330920",
        "969673530920",
        "969744630920",
        "3003349840920",
        "18446742886400752536",
        "18446740511444852536",
        "969673530920",
        "969667200000",
        "969702330100",
        "969702330000",
        "969702330100",
        "969702330000",
        "969702330100",
        "969702330000",
    ]);
    expect(result[0].batches[0].columns[0].VALIDITY.slice(0, 29)).toEqual([
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
        1,
    ]);
});
