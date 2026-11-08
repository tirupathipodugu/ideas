// The words of the game. Each card's text is also read aloud (vo/<key>-<part>.mp3, made by tools/vo.mjs).
export const INTRO = {
  kicker: 'A game about Diwali', title: 'Why do people celebrate Diwali?',
  paras: ['Every year, on the darkest night of autumn, more than a billion people light lamps.', 'Different people have different reasons. Play through six stories and find out why, one lamp at a time.'],
};

export const CH = [
  { key: 'rama', kicker: 'Story 1 · The Ramayana', title: 'The way home',
    story: ['Prince <b>Rama</b> was sent to live in the forest for 14 years. There, the demon king <b>Ravana</b> took his wife, <b>Sita</b>.', 'With his brother <b>Lakshmana</b> and Hanuman’s army, Rama rescued her and defeated Ravana. Now they are walking home to <b>Ayodhya</b>, on a night with no moon.'],
    tip: 'Tap the lamps to light their way home',
    fact: ['The people of Ayodhya lit rows of clay lamps to welcome them home.', 'That is the name: <b>Deepavali</b> means <b>“a row of lamps”</b>. In North India, this homecoming is the heart of Diwali.'] },
  { key: 'krishna', kicker: 'Story 2 · Krishna', title: 'The night before',
    story: ['The demon king <b>Narakasura</b> spread fear across the land, and held <b>16,000 people</b> captive.', '<b>Krishna</b> and his wife <b>Satyabhama</b> set out to stop him. Every shadow that reaches the city puts out a light.'],
    tip: 'Tap the shadows to throw Krishna’s chakra',
    fact: ['Krishna defeated Narakasura, and freed every captive.', 'This is <b>Naraka Chaturdashi</b>, or Choti Diwali, the day before the main night. In much of South India, it is the main day of Diwali: an early oil bath, new clothes, and lamps.'] },
  { key: 'lakshmi', kicker: 'Story 3 · Lakshmi', title: 'Welcome home, Lakshmi',
    story: ['<b>Lakshmi</b> is the goddess of wealth and good fortune.', 'On the main night of Diwali, the <b>new moon</b>, families get their homes ready to welcome her in.'],
    tip: 'Swipe to sweep the floor clean',
    fact: ['A clean home, a <b>rangoli</b> at the door, and lamps everywhere: that is how families invite Lakshmi in. Many draw her small footprints, walking into the house.', 'Many businesses also start their new account books on this night.'] },
  { key: 'bandi', kicker: 'Story 4 · The Sikh story', title: 'The Day of Liberation',
    story: ['In the 1600s, the Mughal emperor <b>Jahangir</b> held the sixth Sikh Guru, <b>Guru Hargobind</b>, in Gwalior Fort, along with <b>52 kings</b>.', 'When the Guru was to be freed, he would not leave without the kings. The emperor said: only those who can hold on to the Guru’s cloak may go. So the Guru had a cloak made with <b>52 tassels</b>.'],
    tip: 'Tap the cells to set all 52 kings free',
    fact: ['Each king held a tassel, and walked out free. The Guru reached <b>Amritsar</b> at Diwali, and the Golden Temple was lit with lamps.', 'Sikhs celebrate this as <b>Bandi Chhor Divas</b>: the Day of Liberation.'] },
  { key: 'mahavira', kicker: 'Story 5 · The Jain story', title: 'The light of knowledge',
    story: ['<b>Mahavira</b>, the 24th Jain Tirthankara, taught non-violence and truth.', 'On the night of Diwali, about 2,500 years ago, he reached <b>nirvana</b>: freedom from the cycle of birth and death. His followers said: the light of knowledge has gone, so let us light lamps.'],
    tip: 'Drag the flame from lamp to lamp. Gently, or it goes out',
    fact: ['Jains celebrate Diwali as the night of <b>Mahavira’s nirvana</b>, and many start their new year the next day.', 'Moving gently fits the story: <b>ahimsa</b>, non-violence, is at the heart of what he taught.'] },
  { key: 'days', kicker: 'Story 6 · The festival', title: 'Five days, not one night',
    story: ['Diwali is not just one night. It runs for <b>five days</b>, and each day has its own meaning.', 'Light the days in order.'],
    tip: 'Tap the five days in order, first to last',
    fact: ['From <b>Dhanteras</b> to <b>Bhai Dooj</b>: five days of lamps, sweets, family, and new beginnings.', 'Places add their own, too: <b>Kali Puja</b> in Bengal, <b>Bali Pratipada</b> in Karnataka and Maharashtra, and the <b>new year</b> in Gujarat.'] },
];

export const DAYS = [
  ['🪙', 'Dhanteras', 'Buy something new, like gold, silver or a pot, and pray for health and wealth.'],
  ['🌅', 'Naraka Chaturdashi', 'Choti Diwali. An early bath and lamps, for Krishna’s win over Narakasura.'],
  ['🪔', 'Lakshmi Puja', 'The main night, under the new moon. Lamps everywhere and prayers to Lakshmi.'],
  ['⛰️', 'Govardhan Puja', 'Krishna lifted Govardhan hill to shelter his village. A feast of food offerings.'],
  ['🤝', 'Bhai Dooj', 'Sisters and brothers pray for each other and share sweets.'],
];

export const END = {
  kicker: 'Happy Diwali', title: 'So, why Diwali?',
  paras: ['Rama came home. Krishna freed the captives. Lakshmi is welcomed in. The Guru freed 52 kings. Mahavira’s light lives on.', 'In every story, <b>light wins over darkness</b>. That’s why, on the darkest night of the year, people light lamps. <b>Happy Diwali!</b>'],
};

export const plain = (html) => html.replace(/<[^>]+>/g, '').replace(/[“”]/g, '"');
