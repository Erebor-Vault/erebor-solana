import { expect } from "chai";
import { PROTOCOL_REGISTRY, getRegistryForCluster, clusterOrThrow } from "../registry";

describe("PROTOCOL_REGISTRY", () => {
    it("has both clusters", () => {
        expect(PROTOCOL_REGISTRY).to.have.property("devnet");
        expect(PROTOCOL_REGISTRY).to.have.property("mainnet-beta");
    });

    describe("devnet", () => {
        const dev = PROTOCOL_REGISTRY.devnet;

        it("has mockPythProgramId set", () => {
            expect(dev.mockPythProgramId).to.not.be.null;
        });

        it("kamino has all four discriminators", () => {
            const k = dev.protocols.kamino;
            expect(k.programId).to.not.be.null;
            expect(k.discriminators.deposit).to.be.a("string");
            expect(k.discriminators.withdraw).to.be.a("string");
            expect(k.discriminators.borrow).to.be.a("string");
            expect(k.discriminators.repay).to.be.a("string");
        });

        it("lulo has deposit + withdraw", () => {
            const l = dev.protocols.lulo;
            expect(l.programId).to.not.be.null;
            expect(l.discriminators.deposit).to.be.a("string");
            expect(l.discriminators.withdraw).to.be.a("string");
        });

        it("raydium and jupiter are stubbed with notes", () => {
            for (const p of ["raydium", "jupiter"] as const) {
                const entry = dev.protocols[p];
                expect(entry.programId).to.be.null;
                expect(entry.note).to.be.a("string").that.has.length.greaterThan(20);
            }
        });

        it("ships at least one priceFeed for keeper smoke-test", () => {
            expect(dev.priceFeeds.length).to.be.greaterThan(0);
            expect(dev.priceFeeds[0].coingeckoId).to.match(/^[a-z0-9-]+$/);
        });
    });

    describe("mainnet-beta", () => {
        const main = PROTOCOL_REGISTRY["mainnet-beta"];

        it("every protocol entry is null with a FOLLOWUPS note", () => {
            for (const p of ["kamino", "lulo", "raydium", "jupiter"] as const) {
                const entry = main.protocols[p];
                expect(entry.programId, p).to.be.null;
                expect(entry.note, p).to.match(/FOLLOWUPS A4/);
            }
        });

        it("has empty priceFeeds and null mockPythProgramId", () => {
            expect(main.priceFeeds).to.deep.equal([]);
            expect(main.mockPythProgramId).to.be.null;
        });
    });

    describe("getRegistryForCluster", () => {
        it("returns the devnet entry", () => {
            expect(getRegistryForCluster("devnet")).to.equal(PROTOCOL_REGISTRY.devnet);
        });
        it("throws on unsupported cluster", () => {
            // @ts-expect-error testing runtime behaviour
            expect(() => getRegistryForCluster("testnet")).to.throw(/no entry/);
        });
    });

    describe("clusterOrThrow", () => {
        it("accepts devnet + mainnet-beta", () => {
            expect(clusterOrThrow("devnet")).to.equal("devnet");
            expect(clusterOrThrow("mainnet-beta")).to.equal("mainnet-beta");
        });
        it("rejects testnet", () => {
            expect(() => clusterOrThrow("testnet")).to.throw(/does not support/);
        });
    });
});
