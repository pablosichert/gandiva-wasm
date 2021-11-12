import * as Arrow from "../node_modules/apache-arrow/Arrow.dom";
import * as Arquero from "arquero";
import wasmModule from "../dist/gandiva.module";
import Benchmark from "benchmark";
import mapInts from "./mapInts";
import filterInts from "./filterInts";
import filterStrings from "./filterStrings";

async function main() {
    const warn = console.warn.bind(console);
    console.warn = () => { };
    const Gandiva = await wasmModule({
        locateFile: (file: string) => `base/dist/${file}`,
    });
    const fetchData = async (file: string) => {
        const response = await fetch(`base/benchmarks/data/${file}`);
        const blob = await response.blob();
        return await blob.arrayBuffer();
    };

    await filterStrings(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    await filterInts(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    await mapInts(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    console.warn = warn;
}

(window as any).karmaCustomEnv = {
    execute: async (karma: any) => {
        await main();
        karma.result({ success: true, suite: [], log: [] });
        karma.complete({});
    }
};
