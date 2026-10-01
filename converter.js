*** Begin Patch
*** Update File: converter.js
@@
-      try {
-        settings = core.chooseEnhancement(sourceProfile || core.analyzeSource(loadedBuffer), { strength: strength.factor });
-      } catch (error) {
+      try {
+        const profile = sourceProfile || core.analyzeSource(loadedBuffer);
+        settings = core.chooseEnhancement(profile, { strength: strength.factor });
+        if (!settings || typeof settings !== 'object') {
+          settings = chooseSmartEnhancement(profile, strength.value);
+        }
+      } catch (error) {
         settings = {
-          eqLow: 1.5, eqMid: 2.5, eqHigh: 2, compThreshold: -20,
-          compRatio: 3.2, limiterCeiling: -1, stereoWidth: 118, targetLufs: -12,
-          artifactCleaner: null
+          eqLow: 1.8, eqMid: 2.2, eqHigh: -1.5, compThreshold: -22,
+          compRatio: 3.8, limiterCeiling: -1.1, stereoWidth: 104, targetLufs: -13,
+          artifactCleaner: true
         };
       }
@@
-        const origin = trigger === 'import'
+        const origin = trigger === 'import'
           ? 'Automatisch nach dem Import angewendet'
           : (trigger === 'strength' ? 'Mit neuer Stärke neu berechnet' : 'Manuell angewendet');
-        return origin + ' · Stärke „' + strength.label + '“'
+        return origin + ' · Stärke „' + strength.label + '“ · intelligent optimiert'
           /*...*/
*** End Patch
