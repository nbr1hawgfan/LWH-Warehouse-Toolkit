/* LWH Warehouse Toolkit — Forklift classroom training content (v1.77.0)
   This file is just the content. Edit freely:
     - videos: YouTube video IDs (the part after watch?v=), title, channel, length
     - minSec: how long the module stays open before Next unlocks
     - points: the key points shown under the video
   If you add or remove a module, bump VERSION so the records show which
   version of the training someone took. Every point here lines up with a
   question in the written test (see "test").
*/
window.LWH_FORKLIFT_TRAINING = {
  VERSION: '2026-11b',
  modules: [
    {
      id: 'basics',
      title: 'Forklift Basics & the Rules',
      test: ['Seatbelt', 'Getting on and off', 'Riders', 'Lifting people'],
      minSec: 210,
      videos: [
        { id: '_tuz1HGTSYE', title: 'Forklift Safety Training — OSHA Requirements, Hazards, and Safe Operation', channel: 'Frontline Data Solutions', length: '10:53' }
      ],
      points: [
        'Only trained and certified operators may drive a forklift. OSHA requires classroom training, a written test and a driving evaluation — renewed at least every 3 years.',
        '<b>Wear your seatbelt every time you operate.</b> If the forklift starts to tip: stay in the seat, hold the wheel, brace your feet and lean away from the fall. Never jump.',
        '<b>Get on and off facing the forklift</b>, using three points of contact (two hands and a foot, or two feet and a hand). Never jump on or off.',
        '<b>No riders — ever.</b> The operator is the only person who rides on a forklift. Not to help you see, not for a few feet.',
        '<b>Never lift a person</b> on the forks, on a pallet or on a load, and never use a wall or pole as a "safety". People may only be raised in a work platform made and approved for it.',
        'No cellphones while operating.'
      ]
    },
    {
      id: 'inspect',
      title: 'Pre-Shift Inspection',
      test: ['How often to inspect'],
      minSec: 150,
      videos: [
        { id: 'ABheJMT41Ps', title: 'CLARK Forklift Safety Pre-Shift Inspection Instructional Video', channel: 'CLARK Material Handling Company', length: '' }
      ],
      points: [
        '<b>Inspect your forklift at least once every shift</b>, before you drive it.',
        '<b>Key off:</b> tires, forks (cracks, bends, worn heels), chains, mast, hydraulic leaks, overhead guard, propane tank or battery, data plate readable.',
        '<b>Key on:</b> horn, lights, backup alarm, brakes and parking brake, steering, lift / tilt controls, seatbelt.',
        'Find a problem? <b>Don\'t drive it.</b> Tag it out of service and tell your supervisor.',
        'Record the inspection on the forklift inspection checklist every shift.'
      ]
    },
    {
      id: 'loads',
      title: 'Loads, Capacity & Stability',
      test: ['Load capacity', 'How high to carry a load', 'Traveling with a raised load'],
      minSec: 210,
      videos: [
        { id: 'xTZGliMfoRk', title: 'Forklift Stability Triangle Explained — Tip Over Prevention', channel: 'Lift Parts Warehouse', length: '7:39' },
        { id: 'YBLlLgTh24E', title: 'How to Read a Forklift Data Plate & Determine Capacity', channel: 'W.D. Matthews Machinery Co.', length: '', optional: true }
      ],
      points: [
        '<b>Never exceed the capacity on the data plate — not at any time.</b> Not because a supervisor says so, not "just a couple of inches off the floor". If you can\'t read the data plate, don\'t lift; report it.',
        'Capacity is rated at a load center (usually 24 in.). A long load, or weight sitting out toward the fork tips, lowers what the forklift can safely lift. Attachments lower it too.',
        'Spread the forks wide, slide them all the way under, load against the backrest, tilt the mast back slightly.',
        '<b>On a smooth floor, carry the load 2–3 inches off the surface</b>, tilted back.',
        '<b>Never travel with a load at its maximum height</b> — not to see better, not because there\'s room. Raise and lower only when stopped and in position. A raised load moves the center of gravity up and makes a tip-over far more likely.',
        'The stability triangle: the forklift stays upright while the combined center of gravity stays inside the triangle between the front wheels and the rear axle pivot. Raised loads, sharp turns, speed and slopes push it out.'
      ]
    },
    {
      id: 'driving',
      title: 'Driving & Pedestrians',
      test: ['Where to look', 'Intersections', 'Right of way', 'Using the horn', 'Following distance'],
      minSec: 120,
      videos: [
        { id: 'kdMOm3R3hRU', title: 'Forklift Safety Training (full course)', channel: 'National Safety Compliance', length: '26:02', optional: true }
      ],
      points: [
        '<b>Pedestrians have the right of way — in all situations.</b> Not the bigger forklift, not the forklift on the right, not the senior operator.',
        '<b>Always look in the direction of travel.</b> If the load blocks your view, drive in reverse — and still look where you\'re going.',
        '<b>At intersections and cross aisles: slow down and sound the horn.</b> Same at doorways and blind corners. Never lean out of the overhead guard to look.',
        'The horn is for <b>warning pedestrians and other traffic at intersections and blind spots</b> — not for hurrying people out of your way or saying hi.',
        '<b>Keep a safe braking distance between moving forklifts</b> — about three truck lengths. Don\'t pass at intersections or blind spots.',
        'Drive at a speed that lets you stop safely. Slow down on wet or uneven floors and before turning. Keep arms, legs and head inside the forklift. No horseplay.'
      ]
    },
    {
      id: 'docks',
      title: 'Ramps, Docks & Trailers',
      test: ['Driving down a ramp', 'Before entering a trailer'],
      minSec: 210,
      videos: [
        { id: 'p3C0DzFxqlw', title: 'How to Safely Operate a Forklift on a Ramp or Sloped Surface', channel: 'Alexander Equipment Rental', length: '3:02' },
        { id: 'R_yjJ8fFhbQ', title: 'Trailer Loading and Unloading with a Forklift', channel: 'ProTread', length: '3:19' }
      ],
      points: [
        '<b>On a ramp, keep the load on the uphill side.</b> Loaded: drive forward going up, <b>back down when loaded</b> going down. Empty: forks pointing downhill.',
        'Go slow on ramps and never turn on one.',
        '<b>Before you drive into a trailer: the wheels must be chocked or the trailer locked to the building</b> (dock lock / vehicle restraint), with the trailer brakes set.',
        'If the trailer isn\'t hooked to a tractor, make sure trailer stands (jacks) are under the front.',
        'Check the trailer floor and dock plate before you cross them. Keep away from dock edges.'
      ]
    },
    {
      id: 'fuel',
      title: 'Fueling, Charging & Parking',
      test: ['Refueling / charging', 'Parking and leaving the forklift'],
      minSec: 120,
      videos: [
        { id: 'eAruWqd9UCo', title: 'How to Safely Change a Propane Tank on a Forklift', channel: 'Conger Industries', length: '2:50' }
      ],
      points: [
        '<b>No smoking or open flame</b> anywhere near refueling, a propane tank change, or battery charging. Engine off.',
        'Propane: wear gloves and safety glasses, close the tank valve before disconnecting, check for leaks, and report any damaged tank. Store tanks only in the tank cage.',
        'Battery charging: only in the charging area, with the right PPE. Keep eyewash and emergency equipment clear and reachable.',
        '<b>Park only in a designated area, out of traffic</b> — never in a drive aisle or walkway, and never blocking fire exits, extinguishers or electrical panels.',
        'When you leave the forklift: <b>forks fully lowered, controls in neutral, parking brake set, key off.</b> On a slope, block the wheels.'
      ]
    }
  ]
};
