import fs from "fs";
import { ensureEnvVar, uint256ToBigNumber, generateRandomStarkPrivateKey, prettyPrintFee } from "./util";
import { Wallet, BigNumber } from "ethers";
import BN from "bn.js";
import { Contract, ec, json, Account, Provider, uint256, hash, ProviderInterface } from "starknet";

import { getStarkPair } from "./keyDerivation";

import * as dotenv from "dotenv";
dotenv.config();

// TODO: calculate this
const ACCOUNT_CLASS_HASH = "0x750cd490a7cd1572411169eaa8be292325990d33c5d4733655fe6b926985062";

export class StarkNetWallet {
  private account: Account;
  public provider: ProviderInterface;

  constructor(privateKey: string, provider: ProviderInterface, address?: string) {
    this.provider = provider;
    if (address == undefined) {
      address = StarkNetWallet.computeAddressFromPk(privateKey);
    }
    this.account = StarkNetWallet.getAccountFromPk(address, privateKey, this.provider);
    return;
  }

  getAddress() {
    return this.account.address;
  }

  static computeAddressFromMnemonic(mnemonic: string, index = 0): string {
    const starkKeyPair = getStarkPair(mnemonic, index);
    let starkKeyPub = ec.getStarkKey(starkKeyPair);
    return hash.calculateContractAddressFromHash(starkKeyPub, ACCOUNT_CLASS_HASH, [starkKeyPub], 0);
  }

  static computeAddressFromPk(pk: string): string {
    const starkKeyPair = ec.getKeyPair(pk);
    let starkKeyPub = ec.getStarkKey(starkKeyPair);
    return hash.calculateContractAddressFromHash(starkKeyPub, ACCOUNT_CLASS_HASH, [starkKeyPub], 0);
  }

  static getAccountFromPk(address: string, pk: string, provider: ProviderInterface): Account {
    const starkKeyPair = ec.getKeyPair(pk);
    let account = new Account(provider, address, starkKeyPair);
    return account;
  }

  static fromMnemonic(
    mnemonic: string,
    index: number = 0,
    provider: ProviderInterface,
    address?: string,
  ): StarkNetWallet {
    if (address == undefined) {
      address = StarkNetWallet.computeAddressFromMnemonic(mnemonic, index);
    }
    let newWallet = new StarkNetWallet("0x01", provider);
    let account = StarkNetWallet.getAccountFromMnemonic(address, mnemonic, index, newWallet.provider);
    newWallet.account = account;
    return newWallet;
  }

  static getAccountFromMnemonic(
    address: string,
    mnemonic: string,
    index: number = 0,
    provider: ProviderInterface,
  ): Account {
    const starkKeyPair = getStarkPair(mnemonic, index);
    let account = new Account(provider, address, starkKeyPair);
    return account;
  }

  async getBalance(tokenAddress?: string) {
    return StarkNetWallet.getBalance(this.account.address, this.provider, tokenAddress);
  }

  static async getBalance(address: string, provider: ProviderInterface, tokenAddress?: string): Promise<BigNumber> {
    if (tokenAddress == null) {
      tokenAddress = ensureEnvVar("TOKEN_ADDRESS"); // todo: move to config per chain
    }
    const erc20ABI = json.parse(fs.readFileSync("./src/interfaces/ERC20_abi.json").toString("ascii"));
    const erc20 = new Contract(erc20ABI, tokenAddress, provider);
    const balance = await erc20.balanceOf(address);
    let balanceBigNumber = uint256ToBigNumber(balance.balance);
    return balanceBigNumber;
  }

  static async deployNewAccount(mnemonic: string, provider: ProviderInterface): Promise<Account> {
    // Deploy the Account contract and wait for it to be verified on StarkNet.
    console.log("Deployment Tx - Account Contract to StarkNet...");
    const compiledOZAccount = json.parse(fs.readFileSync("./artifacts/Account.json").toString("ascii"));

    let starkKeyPair = getStarkPair(mnemonic, 0);

    let starkKeyPub = ec.getStarkKey(starkKeyPair);

    let futureAccountAddress = hash.calculateContractAddressFromHash(starkKeyPub, ACCOUNT_CLASS_HASH, [starkKeyPub], 0);

    console.log("Future Account Address", futureAccountAddress);

    // TODO: replace with declare/deploy + print future address
    const accountResponse = await provider.deployContract({
      contract: compiledOZAccount,
      constructorCalldata: [starkKeyPub],
      addressSalt: starkKeyPub,
    });
    // Wait for the deployment transaction to be accepted on StarkNet
    console.log(
      "Waiting for Tx " + accountResponse.transaction_hash + " to be Accepted on Starknet - OZ Account Deployment...",
    );
    await provider.waitForTransaction(accountResponse.transaction_hash);
    console.log("✨ Account Deployed at " + accountResponse.contract_address + " !!");
    //Ready to be used !!!
    console.log(`MNEMONIC=${mnemonic}`);
    console.log(`PUBLIC_KEY=${starkKeyPub}`);
    console.log(`ACCOUNT_ADDRESS=${accountResponse.contract_address}`);
    let account = new Account(provider, accountResponse.contract_address, starkKeyPair);
    return account;
  }

  static async deployPrefundedAccount(
    address: string,
    mnemonic: string,
    provider: ProviderInterface,
  ): Promise<Account> {
    // Deploy the Account contract and wait for it to be verified on StarkNet.
    console.log("Deployment Tx - Account Contract to StarkNet...");
    const compiledOZAccount = json.parse(fs.readFileSync("./artifacts/Account.json").toString("ascii"));

    let starkKeyPair = getStarkPair(mnemonic, 0);

    let starkKeyPub = ec.getStarkKey(starkKeyPair);

    let futureAccountAddress = hash.calculateContractAddressFromHash(starkKeyPub, ACCOUNT_CLASS_HASH, [starkKeyPub], 0);

    console.log("Future Account Address", futureAccountAddress);

    let futureAccount = new Account(provider, futureAccountAddress, starkKeyPair);
    let accountResponse = await futureAccount.deployAccount({
      classHash: ACCOUNT_CLASS_HASH,
      constructorCalldata: [starkKeyPub],
      addressSalt: starkKeyPub,
      contractAddress: futureAccountAddress,
    });

    // Wait for the deployment transaction to be accepted on StarkNet
    console.log(
      "Waiting for Tx " + accountResponse.transaction_hash + " to be Accepted on Starknet - OZ Account Deployment...",
    );

    return futureAccount;
  }

  static generateSeed() {
    console.log("THIS IS A NEW ACCOUNT. Please fill in the MNEMONIC field in the .env file");
    let wallet = Wallet.createRandom();
    let mnemonic = wallet.mnemonic;
    console.log("12-word seed: " + mnemonic.phrase);
    return mnemonic.phrase;
  }

  static generatePk(): BigNumber {
    let pk = generateRandomStarkPrivateKey();
    console.log("PK generated", pk);
    return pk;
  }

  async transfer(recipientAddress: string, amount: BigNumber, tokenAddress?: string, decimals: number = 18) {
    if (tokenAddress == null) {
      tokenAddress = ensureEnvVar("TOKEN_ADDRESS");
    }

    const erc20ABI = json.parse(fs.readFileSync("./src/interfaces/ERC20_abi.json").toString("ascii"));
    const erc20 = new Contract(erc20ABI, tokenAddress, this.account);

    const transferAmount = new BN(amount.toString());
    let uint256Amount = uint256.bnToUint256(transferAmount);

    let estimateFee = await this.account.estimateFee({
      contractAddress: tokenAddress,
      entrypoint: "transfer",
      calldata: [recipientAddress, uint256Amount.low, uint256Amount.high],
    });
    prettyPrintFee(estimateFee);

    // alternatively execute by calling the account execute function
    const { transaction_hash: transferTxHash } = await this.account.execute(
      {
        contractAddress: tokenAddress,
        entrypoint: "transfer",
        calldata: [recipientAddress, uint256Amount.low, uint256Amount.high],
      },
      undefined, // abi
      { maxFee: estimateFee.suggestedMaxFee },
    );
    console.log("Awaiting tx ", transferTxHash);
    await this.provider.waitForTransaction(transferTxHash);
    console.log("Tx mined ", transferTxHash);
  }
}
