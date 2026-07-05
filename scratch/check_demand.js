const fs = require('fs');

const raw = JSON.parse(fs.readFileSync('calibration.json', 'utf8'));

const SEASONS = ['Winter', 'PreMonsoon', 'Monsoon', 'PostMonsoon'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const year = 2025;
const growth = 7.9;
const growthMult = Math.pow(1 + (growth / 100 || raw.growth), year - raw.base_year);

console.log('growthMult:', growthMult);

SEASONS.forEach(season => {
  const base = raw.base_demand[season];
  const diurnal = raw.diurnal[season];
  console.log(`\nSeason: ${season}, base: ${base}`);
  const data = HOURS.map(h => {
    const val = base * diurnal[h] * growthMult;
    return val;
  });
  console.log('Sample data (first 3):', data.slice(0, 3));
  console.log('Contains NaN?', data.some(isNaN));
});
