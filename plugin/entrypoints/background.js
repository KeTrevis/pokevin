import { defineBackground } from 'wxt/utils/define-background';
import '../../engine/core.js';
import '../simulator.js';
import '../encounter-simulator.js';
import '../optimizer.js';
import '../chapter-xp.js';
import '../background.js';

export default defineBackground(() => PokevinBackground());
