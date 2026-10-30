/* Built-in examples. The payload floor is the SP26 DevFoam cut (docs/samples/payload-foam-floor),
   reproduced so the app can be checked against real DevFoam output. */
(function (root) {
root.HWExamples = {
  floor: {
    label: 'Payload foam floor (SP26, DevFoam sample)',
    src: { name: 'M2foamfloor.dxf', isAirfoil: false, pts: [[-182.8818,40.4432],[-182.8819,7.0986],[132.3181,7.0986],[132.3181,35.3631],[100.5897,28.373],[101.8379,21.748],[72.3566,16.1935],[71.0456,23.1518],[30.4374,17.4094],[31.0381,10.4751],[1.1501,7.8858],[0.602,14.2121],[0.602,15.5129],[-16.8129,14.8626],[-34.228,14.23],[-47.9246,14.3931],[-61.551,15.6909],[-61.6121,14.9764],[-62.3366,8.6679],[-92.1407,12.0906],[-91.1513,20.7063],[-91.058,21.5179],[-101.5663,24.7796],[-111.5941,29.2331],[-115.2755,31.4882],[-118.7527,34.1551],[-121.6863,37.3707],[-123.2819,41.3406],[-182.8818,40.4432]] },
    settings: { name: 'Payload foam floor', start: 'first', kerfL: 1.5, kerfR: 1.5, speed: 200, spacing: 1, frontX: 2, bottomY: 2, startX: 7.9137, startY: 51.5303, width: 300, block: { length: 330, height: 50.8, margin: 25.4 } },
  },
  wing: {
    label: 'Tapered wing panel (NACA 2412, 300 to 200 mm)',
    settings: { name: 'Tapered wing panel', start: 'te', kerfL: 1.5, kerfR: 1.5, speed: 200, spacing: 1, frontX: 76.2, bottomY: 12.7, startX: null, startY: null, width: 685.8, block: { length: 0, height: 76.2, margin: 25.4 },
      left: { kind: 'naca', naca: '2412', chord: 300, rot: 0 }, right: { kind: 'same', naca: '2412', chord: 200, rot: 0, dx: 40, dy: 5 } },
  },
};
})(this);
