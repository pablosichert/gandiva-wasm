import * as Arrow from "apache-arrow";
import * as Arquero from "arquero";
import wasmModule from "../dist/gandiva.module";
import Benchmark from "benchmark";
import mapInts from "./mapInts";
import filterInts from "./filterInts";
import filterStrings from "./filterStrings";
import path from "path";
import { readFile } from "fs/promises";

async function main() {
    const warn = console.warn.bind(console);
    console.warn = () => { };
    const Gandiva = await wasmModule({
        locateFile: (file: string) => path.join(__dirname, '..', `dist/${file}`),
    });
    const fetchData = async (file: string) => {
        const buffer = await readFile(path.join(__dirname, '..', `benchmarks/data/${file}`));
        return new Uint8Array(buffer).buffer;
    };

    await filterStrings(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    await filterInts(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    await mapInts(Benchmark, Arrow, Gandiva, Arquero, fetchData);
    console.warn = warn;
}

main()
