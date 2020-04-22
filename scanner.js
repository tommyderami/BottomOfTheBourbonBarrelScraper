require('dotenv').config()
const winston = require('winston');
const cheerio = require('cheerio')
const rpn = require('request-promise-native')
const accountSid = process.env.ACCOUNT_SID;
const authToken = process.env.AUTH_TOKEN;
const client = require('twilio')(accountSid, authToken);

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'user-service' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

let results = [];
const options = {
  'method': 'GET',
  uri: process.env.KL_URI,
  headers: {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
  },
  'referrerPolicy': 'no-referrer-when-downgrade',
  'mode': 'cors'
};

const scan = async () => {
    logger.info('Checking bourbons')
    const resHTML = await rpn(options)
    const tempList = []
    const $ = cheerio.load(resHTML)
    $('.new-product-feed.content>div>table>tbody>tr').map((i, el)=> {
      const item = {}
      item.time = $('.formatDate', el).text().trim()
      item.name = $('a', el).text().trim()
      item.link = 'https://klwines.com' + $('a', el).attr('href')
      item.sku = $('td:nth-of-type(2)', el).text().trim()
      item.quantity = $('td:nth-of-type(6)', el).text().trim()
      item.price = $('.price', el).text().trim()
      tempList.push(item)
    })
    const tempItemMap = tempList.reduce((acc, item)=>{
      acc[item.sku] = item
      return acc
    },{})
    if(tempList.length===0) {
      logger.error('No results received')
      return
    }
    if(results.length===0 ){
      logger.info('Setting saved results:', tempItemMap)
      results = tempItemMap
      return
    }
    const resultsSKUs = Object.keys(results)
    const newSKUs = Object.keys(tempItemMap).reduce((acc, sku)=>{
      resultsSKUs.includes(sku) ? null: acc.push(tempItemMap[sku])
      return acc
    },[])
    if(newSKUs.length>0){
      logger.info('Found new order info:', newSKUs)
      results = tempItemMap
      const bodyMsg = newSKUs.reduce((acc, item)=>{return `${acc} ${item.name}: ${item.price} - ${item.quantity} left ${item.link}\n`},'**New Bourbon Alert: \n')
      const slackMsg = newSKUs.reduce((acc, item)=>{return `${acc} ${item.name}: ${item.price} - ${item.quantity} left <${item.link}|Purchase>\n`},'**New Bourbon Alert: \n')
      client.messages.create({
       body: bodyMsg,
       from: process.env.TWILIO_SENDER,
       to: process.env.TWILIO_RECIP
      })
      .then(message => console.log(message.sid))

      rpn({uri: process.env.SLACK_HOOK_URI, method:'POST', body: {icon_emoji:':tumbler_glass:', username: 'booze-bot', text: slackMsg}, json: true})
    } else {
      logger.info('No new bourbons found...')
    }
}
scan()
setInterval(()=>scan(), process.env.POLL_FREQUENCY)
