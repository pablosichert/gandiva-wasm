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
        const dataExpected = JSON.stringify(new Array(expectedRows).fill("").map((_, index) => `#${(index.toString()).padStart(10, "0")}`));
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
        Arrow.Field.new(0, new Arrow.Utf8()),
    ]))));

    const schema = Gandiva.readerSchema(reader);
    const fieldIn = Gandiva.schemaField(schema, 0);
    const nodeIn = Gandiva.makeField(fieldIn);
    const schemaOut = Gandiva.readerSchema(readerOut);
    const fieldOut = Gandiva.schemaField(schemaOut, 0);

    function compileFilter() {
        const typeBoolean = Gandiva.typeBoolean();
        const literal = Gandiva.makeLiteralString("#000000000");
        const startsWithNodes = new Gandiva.NodeVector();
        startsWithNodes.push_back(nodeIn);
        startsWithNodes.push_back(literal);
        const startsWithFunction = Gandiva.makeFunction("starts_with", startsWithNodes, typeBoolean);
        const condition = Gandiva.makeCondition(startsWithFunction);
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
            .add(`Gandiva copy buffer (${numRows}) filter utf8`, () => {
                const reader = makeReader(arrow);
                reader.delete();
            })
            .add(`Gandiva compile filter (${numRows}) filter utf8`, () => {
                const filter = compileFilter();
                filter.delete();
            })
            .add(`Gandiva evaluate filter (${numRows}) filter utf8`, () => {
                const selectionVector = evaluateFilter();
                selectionVector.delete();
            })
            .add(`Gandiva compile projector (${numRows}) filter utf8`, () => {
                const projector = compileProjector();
                projector.delete();
            })
            .add(`Gandiva evaluate projector (${numRows}) filter utf8`, () => {
                const arrayVector = evaluateProjector();
                arrayVector.delete();
            })
            .add(`Gandiva to Buffer (${numRows}) filter utf8`, () => {
                const buffer = toBuffer();
                buffer.delete();
            })
            .add(`Gandiva to Arrow (${numRows}) filter utf8`, toArrow)
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
        return frame.filter('data => op.startswith(data[0], "#000000000")');
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
            .add(`Arquero build frame (${numRows}) filter utf8`, buildFrame)
            .add(`Arquero evaluate filter (${numRows}) filter utf8`, evaluateFilter)
            .add(`Arquero to Arrow (${numRows}) filter utf8`, toArrow)
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
        const arrow = await fetchData(`utf8.${numRows}.arrow`);
        const table = Arrow.Table.from([arrow]);

        console.assert(table.chunks.length == 1, "table.chunks.length", table.chunks.length, "==", 1);

        await filterGandiva(Benchmark, Arrow, Gandiva, arrow, numRows);
        await filterArquero(Benchmark, Arrow, Arquero, arrow, numRows);
    }
}
