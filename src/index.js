import { Telegraf } from 'telegraf';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import sqlite3 from 'sqlite3';
import 'dotenv/config';

const token = process.env.BOT_TOKEN;
const bot = new Telegraf(token);

const rssUrl = 'http://feeds.rucast.net/radio-t';

const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS podcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    link TEXT,
    pubDate TEXT,
    listened INTEGER DEFAULT 0
  )`);
});

async function fetchRSS() {
  const response = await axios.get(rssUrl);
  const result = await parseStringPromise(response.data);
  return result.rss.channel[0].item;
}

async function getNewEpisodes() {
  const episodes = await fetchRSS();
  const newEpisodes = [];

  for (const episode of episodes) {
    const title = episode.title[0];
    const link = episode.enclosure[0].$.url;
    const pubDate = episode.pubDate[0];

    const existing = db.get(`SELECT * FROM podcasts WHERE link = ?`, link);

    if (!existing) {
      db.run(`INSERT INTO podcasts (title, link, pubDate) VALUES (?, ?, ?)`, title, link, pubDate);
      newEpisodes.push({ title, link, pubDate });
    }
  }

  return newEpisodes;
}

bot.command('start', (ctx) => {
  ctx.reply('Добро пожаловать! Я буду присылать вам новые выпуски подкастов.');
});

bot.command('new', async (ctx) => {
  const newEpisodes = await getNewEpisodes();

  if (newEpisodes.length === 0) {
    ctx.reply('Новых выпусков нет.');
  } else {
    newEpisodes.forEach(episode => {
      ctx.replyWithAudio({ url: episode.link }, { caption: episode.title });
    });
  }
});

bot.command('listened', async (ctx) => {
  db.all(`SELECT * FROM podcasts WHERE listened = 0`, (err, rows) => {
    if (err) {
      ctx.reply('Ошибка при получении данных.');
    } else if (rows.length === 0) {
      ctx.reply('У вас нет непрослушанных выпусков.');
    } else {
      // ... в функции обработки команды 'listened' ...
      const buttons = rows.flatMap(episode => ([
        {
          text: episode.title,
          callback_data: `play_${episode.id}`
        },
        {
          text: 'Отметить прослушанным',
          callback_data: `listened_${episode.id}`
        }
      ]));
      // ...

      ctx.reply('Ваши непрослушанные выпуски:', {
        reply_markup: {
          inline_keyboard: buttons.map(button => [button])
        }
      });
    }
  });
});

bot.on('callback_query', async (ctx) => {
  const callbackData = ctx.callbackQuery.data;
  const [action, id] = callbackData.split('_');
  
  switch(action) {
    case 'listened':
      // Обработка пометки подкаста как прослушанного
      db.run(`UPDATE podcasts SET listened = 1 WHERE id = ?`, id, function(err) {
        if (err) {
          ctx.answerCbQuery('Ошибка при обновлении данных.');
        } else {
          ctx.answerCbQuery('Выпуск отмечен как прослушанный.');
          ctx.deleteMessage();
        }
      });
      // ... (существующий код)
      break;
    case 'play':
      // Новый функционал для проигрывания аудиофайла
      const episodeToPlay = await new Promise((resolve, reject) => {
        db.get(`SELECT * FROM podcasts WHERE id = ?`, id, (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        });
      });

      if (episodeToPlay) {
        ctx.reply(`${episodeToPlay.title}\n${episodeToPlay.link}`);
      } else {
        ctx.answerCbQuery('Выпуск не найден.');
      }
      break;
    // Другие case для разных действий
  }
});

bot.launch();
