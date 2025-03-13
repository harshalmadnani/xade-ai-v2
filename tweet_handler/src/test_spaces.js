import { Scraper } from 'twitter-agent';
import { SpaceParticipant } from 'twitter-agent';
import { Logger } from 'twitter-agent';
import { findActiveSpaceId } from 'twitter-agent';
import dotenv from 'dotenv';

async function testSpaces() {
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

  let scraper = null;

  try {
    console.log('Setting up scraper...');
    
    scraper = new Scraper({
      logger: new Logger({ debug: true })
    });
    
    await scraper.login(credentials.username, credentials.password);
    console.log('Successfully logged in');

    // Search for Spaces
    const testUsers = ['elonmusk', 'naval', 'balajis'];
    
    for (const username of testUsers) {
      console.log(`\nSearching for Spaces by @${username}...`);
      
      try {
        const spaceId = await findActiveSpaceId(username, scraper);
        
        if (spaceId) {
          console.log('\nFound Space:', { id: spaceId });

          try {
            const participant = new SpaceParticipant(scraper, {
              spaceId,
              debug: true
            });

            await participant.joinAsListener();
            console.log('Successfully joined Space as listener');
            
            // Listen for 60 seconds
            console.log('Listening to Space for 60 seconds...');
            await new Promise(resolve => setTimeout(resolve, 60000));
            
            // Leave the space
            await participant.leave();
            console.log('Left Space');
          } catch (joinError) {
            console.error('Error joining Space:', joinError.message);
          }
        } else {
          console.log(`No live Spaces found for @${username}`);
        }
      } catch (error) {
        console.error(`Error processing Spaces for @${username}:`, error.message);
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
dotenv.config();
if (!process.env.TWITTER_USERNAME || !process.env.TWITTER_PASSWORD) {
  console.error('Please set TWITTER_USERNAME and TWITTER_PASSWORD environment variables');
  process.exit(1);
}

testSpaces().catch(console.error); 