import type { Event, Suite } from "benchmark";

type Benchmark = typeof import("benchmark");
type Arrow = typeof import("apache-arrow");
type Arquero = typeof import("arquero");

async function verifyResult(Arrow: Arrow, buffer: ArrayBuffer) {
    try {
        const expectedRows = 10;
        const table = Arrow.Table.from(buffer);
        const result = JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString());

        console.assert(result.batches.length == 1, "result.batches.length", result.batches[0].count, "==", 1);
        console.assert(result.batches[0].columns.length == 1, "result.batches[0].columns.length", result.batches[0].columns.length, "==", 1);
        console.assert(result.batches[0].columns[0].count == expectedRows, "result.batches[0].columns[0].count", result.batches[0].columns[0].count, "==", expectedRows);

        const serialized = [...table].map(row => row["0"].toString()).sort();

        const data = JSON.stringify(serialized);
        const dataExpected = JSON.stringify(new Array(expectedRows).fill("").map((_, index) => index.toString()));
        console.assert(data == dataExpected, "data", data, "==", dataExpected);

    } catch (error) {
        console.error("error occurred while verifying result", error);
    }
}

async function filterGandiva(Benchmark: Benchmark, Arrow: Arrow, Gandiva: any, arrow: ArrayBuffer, numRows: number) {
    Gandiva.setCacheCapacity(0);

    async function makeTable(table) {
        const writer = Arrow.RecordBatchFileWriter.writeAll(table);
        return await writer.toUint8Array();
    }

    function makeReader(buffer) {
        return Gandiva.makeReader(buffer);
    }

    const reader = makeReader(arrow);
    const readerOut = makeReader(await makeTable(Arrow.Table.empty(new Arrow.Schema([
        Arrow.Field.new(0, new Arrow.Int32()),
    ]))));

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
        return Gandiva.projectorEvaluateWithSelectionVector(projector, selectionVector, batch);
    }

    const arrayVector = evaluateProjector();

    function toBuffer() {
        return Gandiva.arrayVectorToBuffer(arrayVector, schemaOut);
    }

    const buffer = toBuffer();

    function toArrow() {
        return Gandiva.bufferView(buffer);
    }

    const result = toArrow();

    await verifyResult(Arrow, result);

    return await new Promise<Suite>(resolve => {
        const suite = new Benchmark.Suite();

        suite
            .add(`Gandiva copy buffer (${numRows}) filter int32`, () => {
                const reader = makeReader(arrow);
                reader.delete();
            })
            .add(`Gandiva compile filter (${numRows}) filter int32`, () => {
                const filter = compileFilter();
                filter.delete();
            })
            .add(`Gandiva evaluate filter (${numRows}) filter int32`, () => {
                const selectionVector = evaluateFilter();
                selectionVector.delete();
            })
            .add(`Gandiva compile projector (${numRows}) filter int32`, () => {
                const projector = compileProjector();
                projector.delete();
            })
            .add(`Gandiva evaluate projector (${numRows}) filter int32`, () => {
                const arrayVector = evaluateProjector();
                arrayVector.delete();
            })
            .add(`Gandiva to Buffer (${numRows}) filter int32`, () => {
                const buffer = toBuffer();
                buffer.delete();
            })
            .add(`Gandiva to Arrow (${numRows}) filter int32`, toArrow)
            .on('cycle', (event: Event) => {
                console.log(`${event.target} ${((1 / event.target.stats.mean) * numRows).toFixed(2)}rows/s ${event.target.stats.mean * 1000}ms ${(event.target.stats.mean * 1000) / numRows}ms/row`);
            })
            .on('complete', (event: Event) => {
                resolve(suite);
            })
            .run({ 'async': true });
    });
}

async function filterArquero(Benchmark: Benchmark, Arrow: Arrow, Arquero: Arquero, arrow: ArrayBuffer, numRows: number) {
    function buildFrame() {
        return Arquero.fromArrow(arrow);
    }

    const frame = buildFrame();

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
            .add(`Arquero build frame (${numRows}) filter int32`, buildFrame)
            .add(`Arquero evaluate filter (${numRows}) filter int32`, evaluateFilter)
            .add(`Arquero to Arrow (${numRows}) filter int32`, toArrow)
            .on('cycle', (event: Event) => {
                console.log(`${event.target} ${((1 / event.target.stats.mean) * numRows).toFixed(2)}rows/s ${event.target.stats.mean * 1000}ms ${(event.target.stats.mean * 1000) / numRows}ms/row`);
            })
            .on('complete', (event: Event) => {
                resolve(suite);
            })
            .run({ 'async': true });
    });
}

export default async function (Benchmark: Benchmark, Arrow: Arrow, Gandiva: any, Arquero: Arquero, fetchData: (file: string) => Promise<ArrayBuffer>) {
    for (const numRows of [1048576, 262144, 65536, 16384, 4096, 1024]) {
        const arrow = await fetchData(`int32.${numRows}.arrow`);
        const table = Arrow.Table.from([arrow]);

        console.assert(table.chunks.length == 1, "table.chunks.length", table.chunks.length, "==", 1);

        await filterGandiva(Benchmark, Arrow, Gandiva, arrow, numRows);
        await filterArquero(Benchmark, Arrow, Arquero, arrow, numRows);
    }
}
