import type { Event, Suite } from "benchmark";

type Benchmark = typeof import("benchmark");
type Arrow = typeof import("apache-arrow");
type Arquero = typeof import("arquero");

async function verifyResult(Arrow: Arrow, buffer: ArrayBuffer, numRows: number) {
    try {
        const table = Arrow.Table.from(buffer);
        console.log(await Arrow.RecordBatchJSONWriter.writeAll(table).toString());
        const result = JSON.parse(await Arrow.RecordBatchJSONWriter.writeAll(table).toString());

        console.assert(result.batches.length == 1, "result.batches.length", result.batches[0].count, "==", 1);
        console.assert(result.batches[0].columns.length == 1, "result.batches[0].columns.length", result.batches[0].columns.length, "==", 1);
        console.assert(result.batches[0].columns[0].count == numRows, "result.batches[0].columns[0].count", result.batches[0].columns[0].count, "==", numRows);
    } catch (error) {
        console.error("error occurred while verifying result", error);
    }
}

async function mapGandiva(Benchmark: Benchmark, Arrow: Arrow, Gandiva: any, arrow: ArrayBuffer, numRows: number) {
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

    const typeInt32 = Gandiva.typeInt32();

    const schema = Gandiva.readerSchema(reader);
    const fieldIn = Gandiva.schemaField(schema, 0);
    const nodeIn = Gandiva.makeField(fieldIn);
    const schemaOut = Gandiva.readerSchema(readerOut);
    const fieldOut = Gandiva.schemaField(schemaOut, 0);

    function compileProjector() {
        const literal = Gandiva.makeLiteralInt32(3);
        const nodes = new Gandiva.NodeVector();
        nodes.push_back(nodeIn);
        nodes.push_back(literal);
        const multiplyFunction = Gandiva.makeFunction("multiply", nodes, typeInt32);
        const expressionResult = Gandiva.makeExpression(multiplyFunction, fieldOut);
        const projectorExpressions = new Gandiva.ExpressionVector();
        projectorExpressions.push_back(expressionResult);
        const projector = Gandiva.makeProjector(schema, projectorExpressions);
        return projector;
    }

    const projector = compileProjector();
    const batch = Gandiva.readerReadRecordBatch(reader, 0);

    function evaluateProjector() {
        return Gandiva.projectorEvaluate(projector, batch);
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

    await verifyResult(Arrow, result, numRows);

    return await new Promise<Suite>(resolve => {
        const suite = new Benchmark.Suite();

        suite
            .add(`Gandiva copy buffer (${numRows}) map int32`, () => {
                const reader = makeReader(arrow);
                reader.delete();
            })
            .add(`Gandiva compile projector (${numRows}) map int32`, () => {
                const projector = compileProjector();
                projector.delete();
            })
            .add(`Gandiva evaluate projector (${numRows}) map int32`, () => {
                const arrayVector = evaluateProjector();
                arrayVector.delete();
            })
            .add(`Gandiva to Buffer (${numRows}) map int32`, () => {
                const buffer = toBuffer();
                buffer.delete();
            })
            .add(`Gandiva to Arrow (${numRows}) map int32`, toArrow)
            .on('cycle', (event: Event) => {
                console.log(`${event.target} ${((1 / event.target.stats.mean) * numRows).toFixed(2)}rows/s ${event.target.stats.mean * 1000}ms ${(event.target.stats.mean * 1000) / numRows}ms/row`);
            })
            .on('complete', (event: Event) => {
                resolve(suite);
            })
            .run({ 'async': true });
    });
}

async function mapArquero(Benchmark: Benchmark, Arrow: Arrow, Arquero: Arquero, arrow: ArrayBuffer, numRows: number) {
    function buildFrame() {
        return Arquero.fromArrow(arrow);
    }

    const frame = buildFrame();

    function evaluateProjector() {
        return frame.derive({ 0: data => data[0] * 3 });
    }

    const filtered = evaluateProjector();

    function toArrow() {
        return filtered.toArrowBuffer();
    }

    const result = toArrow();

    await verifyResult(Arrow, result, numRows);

    return await new Promise<Suite>(resolve => {
        const suite = new Benchmark.Suite();

        suite
            .add(`Arquero build frame (${numRows}) map int32`, buildFrame)
            .add(`Arquero evaluate projector (${numRows}) map int32`, evaluateProjector)
            .add(`Arquero to Arrow (${numRows}) map int32`, toArrow)
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

        await mapGandiva(Benchmark, Arrow, Gandiva, arrow, numRows);
        await mapArquero(Benchmark, Arrow, Arquero, arrow, numRows);
    }
}
