// What a visitor can ask for on the enquiry form. Keys are stored; labels are shown.
// Labels finish the sentence "Help with …" on the form, so they stay short.
export const SERVICES = {
  events: 'event content',
  bts: 'a BTS shoot',
  reels: 'reels',
  editing: 'video editing',
  social: 'social media',
  strategy: 'a strategy session',
  website: 'a café website',
  other: 'something else',
};

// Where an enquiry is in the studio's flow: reply, call (where the budget is set), then the outcome.
export const STATUSES = ['new', 'replied', 'call booked', 'won', 'closed'];

// The work already on @contentbook_tee. Play counts are Instagram's, read on 26 October 2026.
export const SEED_WORK = [
  {
    title: 'Chalo Baithak',
    summary: 'Bollywood nights in Glasgow and Edinburgh. We filmed the May tour; the Glasgow reel is the crowd singing louder than the band.',
    metric: '8,466 plays',
    link: 'https://www.instagram.com/reel/DYIjpK2ssiO/',
    image: '/assets/media/work-baithak.jpg',
    video: '/assets/media/work-baithak.mp4',
    alt: 'A singer with a guitar on a low stage, the crowd behind him lit by phone torches',
  },
  {
    title: 'Blank Street, Gordon Street',
    summary: 'Romanticising impromptu matcha breaks: a reel shot across the counter at 42 Gordon Street, Glasgow.',
    metric: '2,173 plays',
    link: 'https://www.instagram.com/reel/DUsqDmvDbRA/',
    image: '/assets/media/work-matcha.jpg',
    video: '/assets/media/work-matcha.mp4',
    alt: 'An iced matcha latte in a clear cup on the Blank Street counter, green straws behind it',
  },
  {
    title: 'Our own channel',
    summary: "Let's fix what's holding you back: Tisha on why good brands stall, and what a strategy session changes.",
    metric: '4,412 plays',
    link: 'https://www.instagram.com/reel/DUBNTIhCCKq/',
    image: '/assets/media/work-consult.jpg',
    video: '/assets/media/work-consult.mp4',
    alt: 'Tisha talking to camera in a denim jacket',
  },
  {
    title: 'KDP Studios',
    summary: 'A private Bollywood night with dhol and DJ, filmed with KDP Studios in January 2026.',
    metric: '1,715 plays',
    link: 'https://www.instagram.com/reel/DTH_F5CiHB4/',
    image: '/assets/media/work-kdp.jpg',
    video: '/assets/media/work-kdp.mp4',
    alt: 'Guests dancing under coloured party lights',
  },
];

export const WORK_DEFAULTS = { summary: '', metric: '', link: '', video: '', alt: '', published: 1 };
