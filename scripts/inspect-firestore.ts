import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import firebaseConfigData from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfigData);
const db = getFirestore(app);

async function inspect() {
  console.log('Connecting to Firestore project:', firebaseConfigData.projectId);
  try {
    const snap = await getDocs(collection(db, 'devices'));
    console.log(`Found ${snap.size} device(s) in Firestore:`);
    snap.forEach((doc) => {
      const data = doc.data();
      console.log(`\nDevice ID: ${doc.id}`);
      console.log(`Name: ${data.name}`);
      console.log(`Status: ${data.status}`);
      console.log(`Status2: ${data.status2}`);
      console.log(`Owner: ${data.ownerEmail}`);
      console.log(`Updated: ${data.updatedAt}`);
      console.log(`LastSeen: ${data.lastSeen}`);
      console.log(`All keys:`, Object.keys(data));
    });
  } catch (err) {
    console.error('Error querying devices:', err);
  }
  process.exit(0);
}

inspect();
