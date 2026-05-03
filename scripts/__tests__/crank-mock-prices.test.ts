import { expect } from "chai";
import { fetchPricesUsd, derivePriceFeedPda } from "../crank-mock-prices";
import { PublicKey } from "@solana/web3.js";

function fakeFetch(body: any, ok = true): typeof fetch {
    return (async () =>
        ({
            ok,
            status: ok ? 200 : 500,
            statusText: ok ? "OK" : "Internal Server Error",
            json: async () => body,
        }) as Response) as unknown as typeof fetch;
}

describe("crank-mock-prices: fetchPricesUsd", () => {
    it("returns a map keyed by coingecko id with i64 prices at expo -8", async () => {
        const fetchImpl = fakeFetch({
            "usd-coin": { usd: 1.0001 },
            solana: { usd: 150.42 },
        });
        const out = await fetchPricesUsd(["usd-coin", "solana"], fetchImpl);
        expect(out.get("usd-coin")).to.equal(BigInt(100010000));
        expect(out.get("solana")).to.equal(BigInt(15042000000));
    });

    it("skips ids missing from the response", async () => {
        const fetchImpl = fakeFetch({ "usd-coin": { usd: 1 } });
        const out = await fetchPricesUsd(["usd-coin", "missing-id"], fetchImpl);
        expect(out.has("usd-coin")).to.be.true;
        expect(out.has("missing-id")).to.be.false;
    });

    it("returns empty map for empty input", async () => {
        const out = await fetchPricesUsd([]);
        expect(out.size).to.equal(0);
    });

    it("throws on non-OK response", async () => {
        const fetchImpl = fakeFetch({}, false);
        let err: Error | null = null;
        try {
            await fetchPricesUsd(["usd-coin"], fetchImpl);
        } catch (e: any) {
            err = e;
        }
        expect(err).to.not.be.null;
        expect(err!.message).to.match(/CoinGecko fetch failed/);
    });
});

describe("crank-mock-prices: derivePriceFeedPda", () => {
    it("matches the seeds [b'price', mint] under the supplied program ID", () => {
        const programId = new PublicKey("2AnSsnWA2W64aAtBEHtouJkotTqXwTSEEvDPfa4YURoq");
        const mint = new PublicKey("7MNPXdG3oEWFdJNGPuQMDVZzGNXts1zhCLejD49Lp3hE");
        const pda = derivePriceFeedPda(programId, mint);
        const [expected] = PublicKey.findProgramAddressSync(
            [Buffer.from("price"), mint.toBuffer()],
            programId,
        );
        expect(pda.toBase58()).to.equal(expected.toBase58());
    });
});
