import TonWeb, {TransferMethodParams} from 'tonweb';
import {validateMnemonic, mnemonicToKeyPair, KeyPair} from 'tonweb-mnemonic';
import {getHttpEndpoint} from '@orbs-network/ton-access';
import {WalletV4ContractR2} from 'tonweb/dist/types/contract/wallet/v4/wallet-v4-contract-r2';
import config from '../config';
import {Cell} from 'tonweb/dist/types/boc/cell';
import {TransferBodyParams} from 'tonweb/dist/types/contract/token/ft/jetton-wallet';
import {BN} from 'bn.js';
import {Address} from 'tonweb/dist/types/utils/address';
import {BOC, Coins} from 'ton3-core';
import {Network} from '@orbs-network/ton-access';
import {bitsToBigUint} from 'ton3-core/dist/utils/numbers';

const TRANSFER_FEE = '0.8';

export default class WalletService {
  walletInstance: WalletV4ContractR2 | undefined;
  mnemonic: string;
  address: string | undefined;
  keyPair: KeyPair | undefined;
  constructor(mnemonic: string) {
    this.mnemonic = mnemonic;
  }

  async getEndpoint(network: string) {
    return await getHttpEndpoint({
      network: network as Network,
    });
  }

  async tonweb(network: string) {
    const endpoint = await this.getEndpoint(network);
    return new TonWeb(new TonWeb.HttpProvider(endpoint));
  }

  async init() {
    const {network} = config.app;
    try {
      const tonweb = await this.tonweb(network);
      const endpoint = await this.getEndpoint(network);
      const provider = new TonWeb.HttpProvider(endpoint);
      const keyPair = await WalletService.mnemonicToKeyPair(this.mnemonic);
      const wallet = new tonweb.wallet.all.v4R2(provider, {
        publicKey: keyPair.publicKey,
      });
      const addr = await wallet.getAddress();
      this.keyPair = keyPair;
      this.walletInstance = wallet;
      this.address = WalletService.toNonBounceableAddress(addr);
      console.info('wallet initialized');
    } catch (error) {
      console.error(error);
      throw new Error('failed to initialize wallet');
    }
  }

  async transferJetton(args: {dest: string; amount: string}) {
    const {jettonWalletAddress, jettonDecimal} = config.app;
    const {dest, amount} = args;
    const address = this.address;
    const queryId = Date.now();
    const sendAmount = TonWeb.utils.fromNano(
      new Coins(amount, {
        decimals: jettonDecimal,
        isNano: false,
      }).toNano()
    );

    if (!address) throw new Error('please initalize wallet first');

    const params: TransferBodyParams = {
      queryId,
      tokenAmount: TonWeb.utils.toNano(sendAmount),
      toAddress: new TonWeb.Address(dest),
      responseAddress: new TonWeb.Address(address),
      forwardAmount: TonWeb.utils.toNano('0.001'),
      forwardPayload: Uint8Array.from([]),
    };
    const payload = WalletService.createTransferBody(params);

    try {
      await this.transfer(jettonWalletAddress, TRANSFER_FEE, payload);
    } catch (error) {
      console.error(error);
      throw new Error('Jetton transfer unknown error');
    }
    return queryId;
  }

  async transfer(dest: string, amount: string, payload?: Cell) {
    const keyPair = this.keyPair;
    const seqno = await this.walletInstance?.methods.seqno().call();

    if (!seqno || !keyPair) throw new Error('please initalize wallet first');

    const body: TransferMethodParams = {
      secretKey: keyPair.secretKey,
      toAddress: dest,
      amount: TonWeb.utils.toNano(amount),
      seqno,
      payload,
    };

    const transfer = this.walletInstance?.methods.transfer(body);
    const result = await transfer?.send();
    console.info('transfer result', result);
  }

  async checkBalanceEnough() {
    const {address} = this;
    if (!address) throw new Error('please initalize wallet first');
    const {network} = config.app;
    const tonweb = await this.tonweb(network);
    const balance = Coins.fromNano(await tonweb.getBalance(address));
    const fee = new Coins(TRANSFER_FEE);
    return fee.lt(balance);
  }

  static async getStatus(addressFromStorage: string, originalQueryId: string) {
    const JettonWalletOpCodes = {
      internal_transfer: 0x178d4519,
      transfer: 0xf8a7ea5,
      notify: 0x7362d09c,
    };
    const {network} = config.app;

    const endpoint = await getHttpEndpoint({
      network: network as Network,
    });
    const tonweb = new TonWeb(new TonWeb.HttpProvider(endpoint));
    let retryCount = 120;
    while (retryCount > 0) {
      try {
        const txs = await tonweb.getTransactions(addressFromStorage, 10);
        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i];
          try {
            const bodySlice = BOC.from(tx.in_msg.msg_data.body).root[0].slice();
            const opCode = bodySlice.loadUint(32);
            if (opCode === JettonWalletOpCodes.notify) {
              const queryId = bodySlice.loadBits(64);
              if (
                queryId &&
                bitsToBigUint(queryId).value.toString() === originalQueryId
              ) {
                return tx.transaction_id.hash
                  .replace('+', '-')
                  .replace('/', '_');
              }
            }
          } catch (err) {
            console.error(err);
          }
        }
      } catch (err) {
        console.error(err);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      retryCount -= 1;
    }
  }

  static async mnemonicToKeyPair(mnemonic: string) {
    const mnemonicArr = mnemonic.split(' ');
    const isValid = await validateMnemonic(mnemonicArr);
    if (!isValid) throw new Error('Invalid mnemonic');
    const keyPair = await mnemonicToKeyPair(mnemonicArr);
    return keyPair;
  }

  static toNonBounceableAddress(address: Address) {
    return address.toString(true, true, false);
  }

  static createTransferBody(params: TransferBodyParams) {
    const cell = new TonWeb.boc.Cell();
    cell.bits.writeUint(0xf8a7ea5, 32); // request_transfer op
    cell.bits.writeUint(params.queryId || 0, 64);
    cell.bits.writeCoins(params.tokenAmount);
    cell.bits.writeAddress(params.toAddress);
    cell.bits.writeAddress(params.responseAddress);
    cell.bits.writeBit(false); // null custom_payload
    cell.bits.writeCoins(params.forwardAmount || new BN(0));
    cell.bits.writeBit(false); // forward_payload in this slice, not separate cell
    if (params.forwardPayload) {
      cell.bits.writeBytes(params.forwardPayload);
    }
    return cell;
  }

  static validateAddress(address: string) {
    return TonWeb.utils.Address.isValid(address);
  }
}
