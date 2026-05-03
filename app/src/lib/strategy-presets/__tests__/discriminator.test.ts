import { expect } from "chai";
import { anchorDiscriminator } from "../discriminator";

describe("anchorDiscriminator", () => {
    it("matches the well-known `deposit` discriminator", () => {
        // Anchor's canonical hash: sha256("global:deposit")[..8]
        // Verified against `anchor idl` output.
        const disc = anchorDiscriminator("deposit");
        expect(disc.toString("hex")).to.equal("f223c68952e1f2b6");
    });

    it("returns 8 bytes for any ix name", () => {
        expect(anchorDiscriminator("foo").length).to.equal(8);
        expect(anchorDiscriminator("a_very_long_snake_case_name_here").length).to.equal(8);
    });

    it("differs for different names", () => {
        expect(anchorDiscriminator("deposit").equals(anchorDiscriminator("withdraw"))).to.be.false;
    });
});
