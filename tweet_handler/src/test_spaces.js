const { Scraper, SpaceParticipant, SttTtsPlugin } = require('twitter-agent');
require('dotenv').config();

// Test credentials
const credentials = {
  username: 'agentk_tech',
  password: 'Commune_dev1',
  email: 'xade1088@gmail.com',
  twoFactorSecret: 'EYWC2NREHPSL7VNH',
  cookies: [
    "guest_id_marketing=v1%3A174154947486197714; Expires=Tue, 09 Mar 2027 19:44:34 GMT; Max-Age=63072000; Domain=twitter.com; Path=/; Secure",
    "guest_id_ads=v1%3A174154947486197714; Expires=Tue, 09 Mar 2027 19:44:34 GMT; Max-Age=63072000; Domain=twitter.com; Path=/; Secure",
    "personalization_id=\"v1_AX+ljjGefRTq2CTzK47Uig==\"; Expires=Tue, 09 Mar 2027 19:44:34 GMT; Max-Age=63072000; Domain=twitter.com; Path=/; Secure",
    "guest_id=v1%3A174154947486197714; Expires=Tue, 09 Mar 2027 19:44:34 GMT; Max-Age=63072000; Domain=twitter.com; Path=/; Secure",
    "kdt=GYJVqPw0KPYMh2xzEiFWXKSLWiHgXLZ4s763xQck; Expires=Mon, 07 Sep 2026 19:44:36 GMT; Max-Age=47260800; Domain=twitter.com; Path=/; Secure; HttpOnly",
    "twid=\"u=1895437758405177344\"; Expires=Fri, 08 Mar 2030 19:44:36 GMT; Max-Age=157680000; Domain=twitter.com; Path=/; Secure",
    "ct0=f32bbcf63d55592683398e02b0603fcdf9023cc0943d3fbdfe4c72ab32546dbcc4e15e8b50884a45d3211bf8dc6da6f33cee6304191cf1a81e2b0ca8ed1dafe1185433a99923db047ab66db2ad0a720d; Expires=Fri, 08 Mar 2030 19:44:36 GMT; Max-Age=157680000; Domain=twitter.com; Path=/; Secure; SameSite=Lax",
    "auth_token=7239b59a9575497de844cca5c4d8af776caf78ca; Expires=Fri, 08 Mar 2030 19:44:36 GMT; Max-Age=157680000; Domain=twitter.com; Path=/; Secure; HttpOnly",
    "att=1-hU0nztw8OgN2mjjF1gqJqZ9HQVKbNGhF9AQX5yoE; Expires=Mon, 10 Mar 2025 19:44:36 GMT; Max-Age=86400; Domain=twitter.com; Path=/; Secure; HttpOnly"
  ]
};

// Reference to the functions from index.js
const findSpacesByUser = require('./index.js').findSpacesByUser;
const joinSpace = require('./index.js').joinSpace;

async function testSpaces() {
  let scraper = null;
  
  try {
    console.log('Starting Twitter Spaces test...');
    
    // Initialize scraper with cookies
    console.log('Initializing scraper with cookies...');
    scraper = await Scraper.fromCookies(credentials.cookies);
    
    // Test login status
    const isLoggedIn = await scraper.isLoggedIn();
    console.log('Login status:', isLoggedIn);
    
    if (!isLoggedIn) {
      console.log('Cookies expired, attempting login with credentials...');
      scraper = new Scraper({
        timeout: 120000,
        headless: false,
        slowMo: 100
      });
      await scraper.persistentLogin(
        credentials.username,
        credentials.password,
        credentials.email,
        credentials.twoFactorSecret
      );
    }
    
    // Test users to check for Spaces
    const testUsers = ['commune_ai', 'agentk_tech'];
    
    for (const username of testUsers) {
      console.log(`\nTesting Spaces for user: @${username}`);
      
      // Find Spaces
      const spaces = await findSpacesByUser(scraper, username);
      
      if (spaces.length > 0) {
        console.log(`Found ${spaces.length} live Spaces for @${username}`);
        
        // Try to join the first Space
        const firstSpace = spaces[0];
        console.log(`Attempting to join Space: "${firstSpace.title}"`);
        
        const participant = await joinSpace(scraper, firstSpace.id, firstSpace.title);
        
        if (participant) {
          console.log('Successfully joined Space! Listening for 60 seconds...');
          
          // Listen for 60 seconds then leave
          await new Promise(resolve => setTimeout(resolve, 60000));
          
          console.log('Test complete, leaving Space...');
          await participant.leave();
        }
      } else {
        console.log(`No live Spaces found for @${username}`);
      }
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    if (scraper) {
      try {
        await scraper.close();
        console.log('Scraper closed successfully');
      } catch (closeError) {
        console.error('Error closing scraper:', closeError);
      }
    }
  }
}

// Run the test
testSpaces().catch(console.error);
