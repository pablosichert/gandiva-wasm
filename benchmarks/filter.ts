import type { Event, Suite } from "benchmark";
import type { Table } from "apache-arrow";
import shuffle from "lodash/shuffle";

type Benchmark = typeof import("benchmark");
type Arrow = typeof import("apache-arrow");
type Arquero = typeof import("arquero");

function runAsync(fn) {
    return {
        defer: true,
        async fn(deferred) {
            await fn();
            deferred.resolve();
        }
    }
}

async function verifyResult(Arrow: Arrow, buffer: ArrayBuffer) {
    try {
        const expectedRows = 10;
        const table = Arrow.Table.from(buffer);
        const result = JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString());

        console.assert(result.batches.length == 1, "result.batches.length", result.batches[0].count, "==", 1);
        console.assert(result.batches[0].columns.length == 1, "result.batches[0].columns.length", result.batches[0].columns.length, "==", 1);
        console.assert(result.batches[0].columns[0].count == expectedRows, "result.batches[0].columns[0].count", result.batches[0].columns[0].count, "==", expectedRows);

        const validity = JSON.stringify(result.batches[0].columns[0].VALIDITY);
        const validityExpected = JSON.stringify(new Array(expectedRows).fill(1));
        console.assert(validity == validityExpected, "validity", validity, "==", validityExpected);

        const data = JSON.stringify(result.batches[0].columns[0].DATA.slice(0, 10).sort());
        const dataExpected = JSON.stringify(new Array(expectedRows).fill(0).map((_, index) => index));
        console.assert(data == dataExpected, "data", data, "==", dataExpected);
    } catch (error) {
        console.error("error occurred while verifying result", error);
    }
}

async function filterGandiva(Benchmark: Benchmark, Arrow: Arrow, Gandiva: any, table: Table, numRows: number) {
    Gandiva.setCacheCapacity(0);

    async function makeReader(table) {
        const writer = Arrow.RecordBatchFileWriter.writeAll(table);
        const buffer = await writer.toUint8Array();
        return Gandiva.makeReader(buffer);
    }

    const reader = await makeReader(table);
    const readerOut = await makeReader(Arrow.Table.empty(new Arrow.Schema([
        Arrow.Field.new(0, new Arrow.Int32()),
    ])));

    const schema = Gandiva.readerSchema(reader);
    const fieldIn = Gandiva.schemaField(schema, 0);
    const nodeIn = Gandiva.makeField(fieldIn);
    const schemaOut = Gandiva.readerSchema(readerOut);
    const fieldOut = Gandiva.schemaField(schemaOut, 0);

    function compileFilter() {
        const typeBoolean = Gandiva.typeBoolean();
        const literal = Gandiva.makeLiteralInt32(10);
        const lessThanNodes = new Gandiva.NodeVector();
        lessThanNodes.push_back(nodeIn);
        lessThanNodes.push_back(literal);
        const lessThanFunction = Gandiva.makeFunction("less_than", lessThanNodes, typeBoolean);
        const condition = Gandiva.makeCondition(lessThanFunction);
        const filter = Gandiva.makeFilter(schema, condition);
        return filter;
    }

    const filter = compileFilter();
    const batch = Gandiva.readerReadRecordBatch(reader, 0);

    function evaluateFilter() {
        const selectionVector = Gandiva.selectionVectorMakeInt32(numRows);
        Gandiva.filterEvaluate(filter, selectionVector, batch);
        return selectionVector;
    }

    const selectionVector = evaluateFilter();

    function compileProjector() {
        const expressionResult = Gandiva.makeExpression(nodeIn, fieldOut);
        const projectorExpressions = new Gandiva.ExpressionVector();
        projectorExpressions.push_back(expressionResult);
        const projector = Gandiva.makeProjectorWithSelectionVectorMode(schema, projectorExpressions, Gandiva.SelectionVectorMode.UINT32);
        return projector;
    }

    const projector = compileProjector();

    function evaluateProjector() {
        const arrayVector = Gandiva.projectorEvaluateWithSelectionVector(projector, selectionVector, batch);
        const buffer = Gandiva.arrayVectorToBuffer(arrayVector, schemaOut);
        return buffer;
    }

    const buffer = evaluateProjector();

    function toArrow() {
        return Gandiva.bufferView(buffer);
    }

    const result = toArrow();

    await verifyResult(Arrow, result);

    return await new Promise<Suite>(resolve => {
        const suite = new Benchmark.Suite();

        suite
            .add(`Gandiva copy buffer (${numRows})`, runAsync(async () => {
                const reader = await makeReader(table);
                reader.delete();
            }))
            .add(`Gandiva compile filter (${numRows})`, () => {
                const filter = compileFilter();
                filter.delete();
            })
            .add(`Gandiva evaluate filter (${numRows})`, () => {
                const selectionVector = evaluateFilter();
                selectionVector.delete();
            })
            .add(`Gandiva compile projector (${numRows})`, () => {
                const projector = compileProjector();
                projector.delete();
            })
            .add(`Gandiva evaluate projector (${numRows})`, () => {
                const buffer = evaluateProjector();
                buffer.delete();
            })
            .add(`Gandiva to Arrow (${numRows})`, toArrow)
            .on('cycle', (event: Event) => {
                console.log(String(event.target));
            })
            .on('complete', (event: Event) => {
                resolve(suite);
            })
            .run({ 'async': true });
    });
}

async function filterArquero(Benchmark: Benchmark, Arrow: Arrow, Arquero: Arquero, table: Table, numRows: number) {
    const frame = Arquero.fromArrow(table);

    function evaluateFilter() {
        return frame.filter(data => data[0] < 10);
    }

    const filtered = evaluateFilter();

    function toArrow() {
        return filtered.toArrowBuffer();
    }

    const result = toArrow();

    await verifyResult(Arrow, result);

    return await new Promise<Suite>(resolve => {
        const suite = new Benchmark.Suite();

        suite
            .add(`Arquero evaluate filter (${numRows})`, evaluateFilter)
            .add(`Arquero to Arrow (${numRows})`, toArrow)
            .on('cycle', (event: Event) => {
                console.log(String(event.target));
            })
            .on('complete', (event: Event) => {
                resolve(suite);
            })
            .run({ 'async': true });
    });
}

export default async function (Benchmark: Benchmark, Arrow: Arrow, Gandiva: any, Arquero: Arquero) {
    for (const numRows of [1_000, 10_000, 100_000, 1_000_000, 10_000_000]) {
        const data = shuffle(new Array(numRows).fill(0).map((_, index) => index));
        const batch = Arrow.RecordBatch.new([Arrow.Int32Vector.from(data)]);
        const table = new Arrow.Table([batch]);

        console.assert(table.chunks.length == 1, "table.chunks.length", table.chunks.length, "==", 1);

        await filterGandiva(Benchmark, Arrow, Gandiva, table, numRows);
        await filterArquero(Benchmark, Arrow, Arquero, table, numRows);
    }
}
