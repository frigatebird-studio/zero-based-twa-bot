import AsyncLock from 'async-lock';
import {Telegraf} from 'telegraf';
import WalletService from '../services/wallet.service';
import config from '../config';

const lock = new AsyncLock();
export default class TelegramUtility {
  bot: Telegraf;
  constructor(tgBotToken: string, domain: string) {
    this.bot = new Telegraf(tgBotToken);
    this.init(domain);
  }
  init(domain: string) {
    this.bot.start(ctx => {
      const chatID = ctx.message?.chat.id;
      ctx.reply('Type /help to get more information');
      const twaUrl = `${domain}?id=${chatID}`;
      ctx.setChatMenuButton({
        type: 'web_app',
        text: 'launch App',
        web_app: {url: twaUrl},
      });
      ctx.telegram.setMyCommands([
        {command: 'send', description: '輸入對方地址以開始轉帳'},
        {command: 'help', description: '顯示指令列表'},
      ]);
    });

    this.bot.command('send', async ctx => {
      const userMessage = ctx.message!.text;
      const destAddress = userMessage!.split(' ');
      if (destAddress.length > 2)
        ctx.reply('Wrong format, Syntax: \n\n/send yourAddress');
      else if (destAddress.length < 2)
        ctx.reply('Missing arguements, Syntax: \n\n/send yourAddress');
      else {
        const {mnemonic, transferAmount, network} = config.app;
        const dest = destAddress[1];

        if (!WalletService.validateAddress(dest)) {
          ctx.reply('invalid address');
          return;
        }

        if (lock.isBusy('transfer_tg')) {
          ctx.reply('service is busy');
          return;
        }

        const wallet = new WalletService(mnemonic);
        await wallet.init();
        const isEnough = await wallet.checkBalanceEnough();
        if (!isEnough) {
          ctx.reply('not enough balance');
          return;
        }

        lock
          .acquire('transfer_tg', async () => {
            const queryId = await wallet.transferJetton({
              dest,
              amount: transferAmount,
            });

            const sendingMessage = `Sending jetton to ${dest}`;
            ctx.reply(sendingMessage);

            const hash = await WalletService.getStatus(
              dest,
              queryId.toString()
            );
            const subdomain = network === 'testnet' ? 'testnet.' : '';
            const tonViewerUrl = `https://${subdomain}tonviewer.com/transaction/${hash}`;
            const successMessage = `Successfully sent \nlink: ${tonViewerUrl}`;
            ctx.reply(successMessage);
            console.info(`transtaction hash: ${hash}`);
          })
          .catch(err => {
            console.error(err);
          });
      }
    });

    this.bot.help(ctx =>
      ctx.reply('Type command */send yourAddress* to send your token')
    );

    this.bot.launch();

    console.info('Telegram bot started');
  }

  send(chatID: string, message: string) {
    this.bot.telegram.sendMessage(chatID, message);
  }
}

let tgBot: TelegramUtility | null = null;

const initTgBot = (tgBotToken: string, domain: string) => {
  tgBot = new TelegramUtility(tgBotToken, domain);
};

export {initTgBot, tgBot};
