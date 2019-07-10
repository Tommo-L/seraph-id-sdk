// Copyright (c) 2019 Swisscom Blockchain AG
// Licensed under MIT License

import { tx, wallet } from '@cityofzion/neon-core';
import { IClaim, ISchema, SeraphIDError } from './common';
import { SeraphIDVerifier } from './verifier';

/**
 * Issuer's interface to issue and revoke Seraph ID credentials.
 */
export class SeraphIDIssuer extends SeraphIDVerifier {
  /**
   * Default constructor.
   * @param scriptHash Script hash of issuer's smart contract.
   * @param networkRpcUrl URL to NEO RPC.
   * @param neoscanUrl URL to NEOSCAN API
   */
  constructor(
    protected readonly scriptHash: string,
    protected readonly networkRpcUrl: string,
    protected readonly neoscanUrl: string,
  ) {
    super(scriptHash, networkRpcUrl, neoscanUrl);
  }

  /**
   * Creates a new claim object without validating its schema.
   * @param claimId Unique ID of the claim generated by issuer. Must be unique across all claims and schemas issued by this issuer.
   * @param schemaName Name of the claim's schema.
   * @param attributes Claim attributes and values.
   * @param ownerDID DID of the person for whom this claim is created.
   * @param validFrom Optional claim's validity start date.
   * @param validTo Optional claim's validity end date.
   * @returns Claim object.
   */
  public createClaim(
    claimId: string,
    schemaName: string,
    attributes: { [key: string]: any },
    ownerDID: string,
    validFrom?: Date,
    validTo?: Date,
  ): IClaim {
    const claim: IClaim = {
      attributes,
      id: claimId,
      ownerDID,
      schema: schemaName,
      validFrom,
      validTo,
    };

    return claim;
  }

  /**
   * Validates claim's schema structure against the schema defined in Issuer's smart contract and mandatory fields.
   * @param claim The claim to be validated.
   * @returns The claim or throws an error in case claim's schema is invalid.
   */
  public async validateClaimStructure(claim: IClaim): Promise<IClaim> {
    if (!claim.schema) {
      throw new SeraphIDError('Schema name is missing');
    }

    if (!claim.ownerDID) {
      throw new SeraphIDError('Owner DID is missing');
    }

    if (!claim.attributes || Object.keys(claim.attributes).length === 0) {
      throw new SeraphIDError('Claim must have at least one attribute');
    }

    const schema = await this.contract.getSchemaDetails(claim.schema);
    const claimAttributes = Object.keys(claim.attributes);
    const unknownAttributes = Object.keys(claim.attributes).filter(attr => !schema.attributes.includes(attr));

    if (unknownAttributes != null && unknownAttributes.length > 0) {
      throw new SeraphIDError(
        `The following attributes are not part of schema ${claim.schema}: ${unknownAttributes.join(',')}`,
      );
    }

    const missingAttributes = schema.attributes.filter(attr => !claimAttributes.includes(attr));
    if (missingAttributes != null && missingAttributes.length > 0) {
      throw new SeraphIDError(
        `The following attributes of schema ${claim.schema} are missing in the claim: ${missingAttributes.join(',')}`,
      );
    }

    return claim;
  }

  /**
   * Signs the claim and issues it to its owner recoding claim's ID on the blockchain.
   * @param claim The claim to be issued.
   * @param gas Additional gas to be sent with invocation transaction.
   * @param intents Intents to be included in invocation transaction.
   * @returns The issued claim with transaction hash inside.
   */
  public async issueClaim(
    claim: IClaim,
    issuerPrivateKey: string,
    gas?: number,
    intents?: tx.TransactionOutput[],
  ): Promise<IClaim> {
    let result: IClaim = await this.validateClaimStructure(claim);

    result.issuerDID = await this.contract.getIssuerDID();
    result = await this.signClaim(claim, issuerPrivateKey);
    result.tx = await this.contract.injectClaim(claim.id, issuerPrivateKey, gas, intents);

    return result;
  }

  /**
   * Revokes an existing claim of specified ID.
   * @param claimId Unique ID of the claim issued by this issuer.
   * @param issuerPrivateKey Private key of the issuer.
   * @param gas Additional gas to send during transaction invocation.
   * @param intents Intents to be added during transaction invocation.
   * @returns Transaction hash if claim was still valid or nothing in case claim did not exist or was already revoked.
   */
  public async revokeClaimById(
    claimId: string,
    issuerPrivateKey: string,
    gas?: number,
    intents?: tx.TransactionOutput[],
  ): Promise<string | void> {
    if (!claimId) {
      throw new SeraphIDError('Claim ID is missing');
    }

    const isValid = await this.contract.isValidClaim(claimId);
    if (isValid) {
      return this.contract.revokeClaim(claimId, issuerPrivateKey, gas, intents);
    }
  }

  /**
   * Revokes the given claim.
   * @param claim Existing claim with specified inique ID.
   * @param issuerPrivateKey Private key of the issuer.
   * @param gas Additional gas to send during transaction invocation.
   * @param intents Intents to be added during transaction invocation.
   * @returns Transaction hash if claim was still valid or nothing in case claim did not exist or was already revoked.
   */
  public async revokeClaim(
    claim: IClaim,
    issuerPrivateKey: string,
    gas?: number,
    intents?: tx.TransactionOutput[],
  ): Promise<string | void> {
    if (!claim) {
      throw new SeraphIDError('Claim must be defined');
    }

    return this.revokeClaimById(claim.id, issuerPrivateKey, gas, intents);
  }

  /**
   * Registers a new credentials schema in Issuer's smart contract.
   * @param name Schema name.
   * @param attributes List of schema attributes.
   * @param revokable Indicates if claims issued for this schema can be revoked.
   * @param issuerPrivateKey Issuer's private key to sign invocation transaction.
   * @param gas Additional gas to send during transaction invocation.
   * @param intents Intents to be added during transaction invocation.
   * @returns Registered schema with transaction hash populated.
   */
  public async registerNewSchema(
    name: string,
    attributes: string[],
    revokable: boolean,
    issuerPrivateKey: string,
    gas?: number,
    intents?: tx.TransactionOutput[],
  ): Promise<ISchema> {
    if (!name) {
      throw new SeraphIDError('Schema name is mandatory');
    }

    if (!attributes || attributes.length === 0) {
      throw new SeraphIDError('Schema must have at least one attribute');
    }

    const schema: ISchema = {
      attributes,
      name,
      revokable,
    };

    schema.tx = await this.contract.registerSchema(schema, issuerPrivateKey, gas, intents);

    return schema;
  }

  /**
   * Signs the claim with issuer's private key.
   * @param claim The claim to be signed by issuer.
   * @param issuerPrivateKey  Issuer's private key.
   * @returns Signed claim
   */
  protected signClaim(claim: IClaim, issuerPrivateKey: string): IClaim {
    const claimHash = super.getClaimHash(claim);
    claim.signature = wallet.sign(claimHash, issuerPrivateKey);
    return claim;
  }
}
