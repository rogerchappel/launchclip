// Sampled instruments (docs/IMMERSIVE_SOUND_RFC.md §1): which recordings each
// instrument plays, where they come from, and the licence they are under.
// Nothing here is bundled: `launchclip sound fetch` downloads the files on
// request into $LAUNCHCLIP_CACHE/instruments/<library>/ and checks each one
// against the SHA-256 pinned below; renders without them fall back to the
// synth instruments in music.mjs.
//
// A zone is [file, sha256, bytes, root, vel, rr]: the file inside its library,
// the MIDI note it sounds (measured, not read from the name: VSCO names notes
// an octave low, and its timpani are named by drum), the velocity layer (0-1)
// and the round-robin index. root null is unpitched (never transposed).
//
// Every library here is CC0 1.0. A CC BY library would set credit_required,
// and its line then goes into renders/credits.txt on every render that used it.

export const SAMPLE_LIBRARIES = {
  'vsco2-ce': {
    title: 'VS Chamber Orchestra: Community Edition',
    author: 'Versilian Studios (recorded by Sam Gossner and Simon Dalzell)',
    licence: 'CC0-1.0',
    licence_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    home: 'https://github.com/sgossner/VSCO-2-CE',
    // Pinned to one commit, fetched file by file.
    source: { kind: 'files', base: 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/' },
    credit_required: false
  },
  'freepats-guitar': {
    title: 'FreePats Spanish Classical Guitar (2019-06-18)',
    author: 'Roberto (FreePats project)',
    licence: 'CC0-1.0',
    licence_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    home: 'https://freepats.zenvoid.org/Guitar/acoustic-guitar.html',
    // One 7z archive; only its samples/ folder and licence text are kept.
    source: { kind: 'archive', url: 'https://freepats.zenvoid.org/Guitar/SpanishClassicalGuitar/SpanishClassicalGuitar-SFZ+FLAC-20190618.7z', sha256: '903916921a21662d2237ade7f0e98e55de93cb7b86da219e4e10f4ad385b8f5e', bytes: 4713892, prefix: 'SpanishClassicalGuitar-SFZ+FLAC-20190618/' },
    credit_required: false
  }
};

/** kind: sustain (held, extended past the recording when needed) or oneshot; release in seconds to −60 dB. */
export const SAMPLED_INSTRUMENTS = {
  'violins-sustain': {
    title: 'Violin section, sustained with vibrato', library: 'vsco2-ce', kind: 'sustain', release: 0.45,
    zones: [
      ['Strings/Violin Section/susVib/VlnEns_susVib_A2_v1.wav', '5b3ff9f991642a6dc2fdad56a7d94f581077d2c4082cc1ed89156737716ff22c', 1979216, 57, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_A2_v2.wav', 'db6bad06c78577a105f6c2a5dc5c7ac0643c36e6904742411f0506dd9d6fa84b', 2231504, 57, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_A3_v1.wav', '72817a53dfd2eb61eca94658c14e1cab6017629ca2f27bab8e394c6675bfaad7', 1890316, 69, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_A3_v2.wav', '3fc4a9e22037643fce11e755da72c61c664893f83e637c24a7b5c2d3824ab986', 1671704, 69, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_B2_v1.wav', '1a873970a86da78ed8c9aa068303958496c34eee6fa94fcab39d499dbdfb7826', 2314360, 59, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_B2_v2.wav', 'a822fd195e60881afac5e0801d8d494b782a8f6787a08f3c711f5e00290b3fb6', 2373380, 59, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_B4_v1.wav', 'ec4cea41ac77f251bf5f4158fe9cbeeae13755e3785106e505808de18fdddc0d', 2056964, 83, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_B4_v2.wav', 'bdb85532f47e4ebd681f9617a415116e7e5aeb786dce2eeab5ab9b93c1b31644', 1923744, 83, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_C4_v1.wav', 'c07edd5b2119fa1da2207aba996961b50dd616f69bbcf2300ab271bc6c16239f', 2063320, 72, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_C4_v2.wav', '5857387b40c412f756ef281c1171247664432a4e5078c98142d595d15cd92ef9', 2017512, 72, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_D3_v1.wav', '583e660bc5daa4e094aef5fc014fbb92751040be8741ed7a16847306a1fe0a99', 2061808, 62, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_D3_v2.wav', '77893dbf1ea1be8c40ad756d16b916298e6b1b0742495e9853e020375592357c', 2457908, 62, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_D5_v1.wav', 'f8d870457826c94270b9c3ead8e8ec02cb7e6c4a3481cded055641b7fab7df62', 2116352, 86, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_D5_v2.wav', '0c2ca9de723bed0a0968e32126b934f778cd678b367a29e7fde91004daf84daf', 1976276, 86, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_E4_v1.wav', '787fb4bcfb47d5c88ee1573c8db15f32d345386301be4a8eea6a825847413ae2', 2315540, 76, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_E4_v2.wav', '030c09a631ebbc7304fc0b47bb5c346cd646e7451d9fdc531870f2534c60d9e9', 1702620, 76, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_F#3_v1.wav', '8dc13d197373f0d1fe1b0744de57796800bde372906d3667398c55d473a383ea', 1585612, 66, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_F#3_v2.wav', 'd7bc6b4c259b9543de4fe66228ee107205b8f539c8d7c1de71f5781d45a14fc7', 1720800, 66, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_G2_v1.wav', 'feb96c5064fbef43087c495d61a9cab9f70ff1be5b22905147c1f86d5f89547c', 2341712, 55, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_G2_v2.wav', 'c0b06a23f0245c042f0609dc0db704adc14bfc9ea8a34cb5c97d80096715a0e6', 2681324, 55, 1, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_G4_v1.wav', 'ed2a89cf254432d2af073699fa43ebfa16cfbc5552c7fc964a184fc434eaaa39', 2330236, 79, 0.5, 1],
      ['Strings/Violin Section/susVib/VlnEns_susVib_G4_v2.wav', 'a1d6d5a0397541692e2f88a0cd9820eabe90407784ee631aa3bfa74772637a65', 2150136, 79, 1, 1]
    ]
  },
  'violins-pizz': {
    title: 'Violin section, pizzicato', library: 'vsco2-ce', kind: 'oneshot', release: 0.12,
    zones: [
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A2_v1_rr1.wav', '056e2e28e989446da8cdda21f62211a7a30699ea03f4ea074045e85c708a0ea8', 220926, 57, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A2_v1_rr2.wav', '3f795534c596db359e7675f99b877a3b05bf8475e0a392cc1dc258e16c75e282', 247290, 57, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A2_v2_rr1.wav', '75a9bbd0120e03affffe89dd711e5a088507917362e0a197019ff9eff8101340', 187354, 57, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A2_v2_rr2.wav', 'da100ff90d5c4568b9d1787627ecf2114fc08f140f2d8481e547572ff5404a42', 315758, 57, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A3_v1_rr1.wav', '6807c9f8a2b8851e866e1f9bb92e9809982693e3593882673d0fe6dedf9b7a96', 163490, 69, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A3_v1_rr2.wav', 'aa4d92ddd001ca80737ffcd3aa6a10f6e1b27192bb47a184c05f183475343385', 180382, 69, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A3_v2_rr1.wav', '631720219cbd7b11718b393bdacf04eb512ef5071f9e5d0d73d74b3f17179ec2', 194010, 69, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_A3_v2_rr2.wav', 'aa6e4d7c84536837e6b9b19203b701a83263b2f4005fc44bd0959321e80c91a5', 205482, 69, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B2_v1_rr1.wav', '6c6e279b3013700f7b0d47042b58679c5d4788637860f6a4788ee6ae7fa25940', 124886, 59, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B2_v1_rr2.wav', 'f01036c3a58c277e487070603c81658ff07e9e1ca8bdfa0e22dd1c9f65c2b432', 116098, 59, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B2_v2_rr1.wav', '71aaf7c111d427e76d91a58efc4cf661880cae85ec91123f8f57d421fe36cd06', 180134, 59, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B2_v2_rr2.wav', '4b9b81daa260704f90fb5883263a9fdbe4cb3c74389346b0592ef85f479d5e1c', 292378, 59, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B4_v1_rr1.wav', '69296888a511f280644945ac4aa2890ed90913308a12e7e1f5b7a1cabeffbd6a', 88054, 83, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B4_v1_rr2.wav', 'f737d67995a452003352e9d85eb1357c99354b7e040a44cb6c4ac5b57a0d1d20', 92066, 83, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B4_v2_rr1.wav', 'ec6f6320f9403a5e0bbb1d0c534abe667a6a2093654343a389b26cf083d513d2', 106362, 83, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_B4_v2_rr2.wav', 'a316a9761252799f7d5aa64987076432e57b2b4ba31a572e390c4f294ff114f2', 126302, 83, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_C4_v1_rr1.wav', '7002bd5b93f26bb773ff77e349fbb3b5aa059404889706ddda9673da7488886c', 105914, 72, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_C4_v1_rr2.wav', '738c073c13a365f5dcc75f07ef5c540eb15c228e493dc406b9467168af894421', 122922, 72, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_C4_v2_rr1.wav', '909eb79fc2c9076909680fa3c2dabdbbd15870f674a883ddab33bbcd0dac965a', 184590, 72, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_C4_v2_rr2.wav', 'f7ca78a98e4d7dae1ad0a1e1d7f20d9696aedb22751748a3b28f5c4ec2df7de2', 197238, 72, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D3_v1_rr1.wav', 'fb8819b3626d141393a6bd25daaba728dade39b9f611e6ec449d9018fb3f699c', 280306, 62, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D3_v1_rr2.wav', '82cca3cf7e1d9893cedc42b23c5ee4cfcfce1f9d764936e5f72977857c998e13', 375514, 62, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D3_v2_rr1.wav', '772b8e3bf0f0143cd9aa73dbf64607a41776c0f124c62ef3fecb835f3510ce6a', 391226, 62, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D3_v2_rr2.wav', '386de13448544594429d903be5603ff6b302b2582a6734ec0d754c3cbf284efd', 410238, 62, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D5_v1_rr1.wav', '47e1b6e331e8fd51f820f3676ecbd046b194a240334009d891fe183b32613ab7', 122870, 86, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D5_v1_rr2.wav', 'e9ac949d9d0e90cd98e00b6ace9e66ea42352920b6de744ae8ae1816cd0e20ee', 77634, 86, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D5_v2_rr1.wav', '50445c5f94fe25272ed98dd03d5af1c34b555f24aa2a7803653aa3b51ed929fc', 113286, 86, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_D5_v2_rr2.wav', 'cbb872a715f93bba14d7913000015e89aefd477e3c1a7535c8e864e8fa6c0583', 125806, 86, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_E4_v1_rr1.wav', '415fce1c81bcaad3a0eac27d328f0c9c0963f7a639823faba9f430bf6d8d5f81', 109318, 76, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_E4_v1_rr2.wav', '93ca0b47eb68569f71ab6c9506f776014d05fc5d88763eec64e7b2704a623231', 150326, 76, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_E4_v2_rr1.wav', '1e1dcef99c3961a601ed0c8336fbf4819fd432ab783445fe4f44fc488e598993', 146742, 76, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_E4_v2_rr2.wav', '7d30e264bdb4884d9d6fe1e6a36e87ada920fa9c630576208510e27f3b2cd22b', 167882, 76, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_F#3_v1_rr1.wav', 'a4b60e0fe3090df0282dfd78eb74ac0a4977d8029ed69dd1d67d736e76d33362', 197422, 66, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_F#3_v1_rr2.wav', 'bfbdce2c919c8959ec11b49224736af943253b31427577ff6e073f0a20f90b74', 135562, 66, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_F#3_v2_rr1.wav', '2c6093daad3f6f7a977ac9775660b57227429651d35d489d6f98e617067e8ea6', 157066, 66, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_F#3_v2_rr2.wav', 'fef269022693eef0b318c1db1a03658f1063ee4d7e3b3bb25e29add97bad6cdc', 176738, 66, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G2_v1_rr1.wav', '7e424e4d35016be590f352eb9961e9175d6ecfceb31c010dd9f38d5905e518f6', 409242, 55, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G2_v1_rr2.wav', '80df42a5f496d3f41a13345239baa41ab454bf000c95272eb1690e1a2905a3a7', 459646, 55, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G2_v2_rr1.wav', '8de544d9df9ced1fc296d8c4589d354112339802f722361f8625a604ccfd556b', 532010, 55, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G2_v2_rr2.wav', '85f4cdeff82491f0c6d1b881f5403aa178ac08b538498ba5179fd2c9c7004157', 437694, 55, 1, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G4_v1_rr1.wav', '5e3c5dad3385efc081975f7fc76b7574699d836fe01a714afffa2ef1054f8ef8', 148766, 79, 0.5, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G4_v1_rr2.wav', '2071d0fc7be9b89ad20f646e02acfe6c8fb9aa93f105cfd224c496669adf0ebe', 82618, 79, 0.5, 2],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G4_v2_rr1.wav', '46d42acdbfe83337f6c6775e03fa99ac99275fd357bdd2d4fa73702c4c7be542', 184102, 79, 1, 1],
      ['Strings/Violin Section/Pizz/VlnEns_Pizz_G4_v2_rr2.wav', 'ac6f949c0f4882274371c49aecc29cf2e91c7e8d741c559dee60107bd25829ab', 170178, 79, 1, 2]
    ]
  },
  'celli-sustain': {
    title: 'Cello section, sustained with vibrato', library: 'vsco2-ce', kind: 'sustain', release: 0.5,
    zones: [
      ['Strings/Cello Section/susvib/susvib_A2_v1_1.wav', 'c97a003184fdcb153d6b6c0bae8d82a90592a1b04b06bd7caaeda8b9776d5284', 2336738, 57, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_A2_v3_1.wav', 'b7f226f19b9616abe5fa4a27ef50116667e19eb0127f30eacfa6d1a83e9149f0', 3082676, 57, 1, 1],
      ['Strings/Cello Section/susvib/susvib_B1_v1_1.wav', '4f95c087c4b8d87ee591e9d39c3c9caf085c6f1b9125eac3ca9e4e637da628ee', 2372492, 47, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_B1_v3_1.wav', '8331a0e13f41243efab111f9b5e9185524c27ee48631269acecafc954ab7eaa8', 3372962, 47, 1, 1],
      ['Strings/Cello Section/susvib/susvib_C1_v1_1.wav', 'abdcea431f384e135c469b0f3e4ac2a437f282f521dc5bcbe22abc221536e8de', 2347376, 36, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_C1_v3_1.wav', '19195ab85ab71626bd11e7100febdaeeba1c237ff5887b934fd0ffd8dfad82cb', 3335948, 36, 1, 1],
      ['Strings/Cello Section/susvib/susvib_C3_v1_1.wav', 'a614ee7ca821b44660236e47b89620cf914ec6ad27a99bc0d9764f47dbe512e1', 2444174, 60, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_C3_v3_1.wav', '51e884d54eea3bf4ba7ee35289a09f15ddb6a52cd849248d01bf18477ccbd07b', 3019394, 60, 1, 1],
      ['Strings/Cello Section/susvib/susvib_D2_v1_1.wav', 'e8640dec9febc6e39fcf06b19d2c95a85d5ff8c38f13c9879e69f551eaf38ab8', 2550956, 50, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_D2_v3_1.wav', 'fc946615cd6550570c8f05d61c0d59b9079bf9daba8bf25be7943487fea5a7ae', 3291368, 50, 1, 1],
      ['Strings/Cello Section/susvib/susvib_E1_v1_1.wav', 'de31a61b02d4e1d5a79b8bc432b0f35fe2e434290ad34402cc0f2dd7dc278cde', 2468348, 40, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_E1_v3_1.wav', 'ee190b95be4f2416b9f41d248d255a4d7067b722f9b21482b30bc9872a9bb0d1', 3080426, 40, 1, 1],
      ['Strings/Cello Section/susvib/susvib_F2_v1_1.wav', '162054eab4ba118924f8f8986cf1b17ccfd65211d1945743ffbae30b4953f901', 2186012, 53, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_F2_v3_1.wav', 'd965197faf2e6ab8675f1d65505e5ba934a5ab769412d314bad94133e18f24d0', 3062696, 53, 1, 1],
      ['Strings/Cello Section/susvib/susvib_G1_v1_1.wav', '9e5d24e8e28d6c7f650f9bb2b33d43c13e341a8bd33124c64e23881378b181ba', 2161700, 43, 0.5, 1],
      ['Strings/Cello Section/susvib/susvib_G1_v3_1.wav', 'e4c61d4ab855ec20ddb69ff608a1c066ff8a779ddd08d1dfe1d534d3a4563ad0', 3370496, 43, 1, 1]
    ]
  },
  'contrabass-pizz': {
    title: 'Solo double bass, pizzicato (the jazz bass)', library: 'vsco2-ce', kind: 'oneshot', release: 0.15,
    zones: [
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A#0_v1_rr1.wav', 'c172382a1c8db63d1893e909da3c0f7f96a60371dce0cfe712e64fd622066fbe', 344328, 34, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A#0_v1_rr2.wav', 'a82a509344a7e03e81f937b0daf647d55c3d47ec01867deeb41463d1d39209af', 326372, 34, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A#0_v3_rr1.wav', 'ffdcf783332627d78bb09c348ce5bbf64e833d529a1cfd48e05362f27a857c0a', 417360, 34, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A#0_v3_rr2.wav', '47ca23f0950ab1ad7c07fd3d4743d826985cc3b79f997c372ead51ebd538a60b', 458396, 34, 1, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A1_v1_rr1.wav', 'c88e632ac4f716d4e85112d6ea5bbe2d27d67019296787c25d27178a9e5f18ac', 623260, 45, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_A1_v1_rr2.wav', 'e7aaefac5eb3986fcec86040e1f7310e84ea38be5d13abe2b3de101c41f43b2b', 485472, 45, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_B2_v1_rr1.wav', '58d70398829e87b9bd3b43fb3d384d9bc3e0aa9bfe70175ec2f4e7a914226c8b', 417472, 59, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_B2_v1_rr2.wav', '22722d1cc3d2a997ec12b37b5dda0221c8d5477669dfa5ff9f77fdde6fd2ba1d', 332204, 59, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_C1_v1_rr1.wav', '5591160a867b21ba193d601390c9e1f35ec8d5deb0de686a410d25a98a103b06', 270720, 36, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_C1_v1_rr2.wav', 'd880b29cafc4b537a5097c9b65a7e20d1be15d60efaf7ceb15e20517b6ad455b', 405984, 36, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_C1_v3_rr1.wav', '706d82ca773408bb6cd6f22466d5d017c1d36a9055f3a6b6af864407b26c5a0d', 400396, 36, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_C1_v3_rr2.wav', '242a0638d0571084b3a40da3a21a3f2dd67585e31601babf85f4251b4f67a3d3', 384920, 36, 1, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_D1_v1_rr1.wav', 'c4db29ae6949cb6c0d24201bb444c1d5b3806505bae47785cb199f5f0f4f02d2', 856252, 38, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_D1_v1_rr2.wav', '4f17f7c828a9d9123c8c6498a27aa6b7a2772a5b937183f3d622f41f56ce21ce', 1062672, 38, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E0_v1_rr1.wav', '7901d4aa056d2a6057a264ce98fc9e66a7ce48575d077a30f14083aa798cd188', 423964, 28, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E0_v1_rr2.wav', '5287fecaedbfce87737d53c77bc19aa78322ef498f143ca2b71bc1ee8dc17845', 412812, 28, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E0_v3_rr1.wav', '790d1a480a0f38216d30ad6e9152bd26a744d9d651a7e822e1fe58883a9c673f', 901744, 28, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E0_v3_rr2.wav', 'f533b634b7f87d75234737b4acbf7bf6f9587f71ee93c12b0bda65bea3e40333', 908620, 28, 1, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E1_v1_rr1.wav', '818fd3e7cc5200774333fc5dbb37e021ed0f155918cafe129acc0e90d37f9d49', 294356, 40, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E1_v1_rr2.wav', '9b87c1440edb95a70ca997ac83cff0d0e84c176f6269a59f86ce381f339f09ce', 315292, 40, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E1_v3_rr1.wav', '7628daebe4a9f8524d46e6d58eee811f437e73c77eb6c21396152af58a062506', 518876, 40, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_E1_v3_rr2.wav', '496f50ac55ae948b2a155fd06a9bc430118b9725eb638c1673ae3c389203ae91', 445256, 40, 1, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#0_v1_rr1.wav', '8d1337d6ba2b8e65e52d0623df7afa66b4b8d1863116cc6f798f629b7e27634b', 256360, 30, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#0_v1_rr2.wav', '4709783a0fbbbf7290cb19e7fb39686f9deecbefec1f736da912b60f7b01ca96', 297240, 30, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#0_v3_rr1.wav', '4bfdab1976e121136ab5d0bfb1e4b79523d5b0c7adf0d35704c98f5cb26713d1', 828940, 30, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#0_v3_rr2.wav', 'e50e59367b9b6707dbb28f97834e1d9bceabc233c5c86d3a61e8af2f5dedaaf4', 910664, 30, 1, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#1_v1_rr1.wav', '6f91a2747ce3cea061c670f7bf5dc8611eef1c3af8d6e2dca75b6dac5a65bfc6', 868632, 42, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_F#1_v1_rr2.wav', '7aece8942bd894dd7f6ed899f11a6c6a5d15ab5266a4a32f68e32babc99c3a08', 1036836, 42, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G#1_v1_rr1.wav', 'bf377a41759c17794901957edc89ff48fb405f98879549916d9b228492f7f8d1', 601752, 44, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G#1_v1_rr2.wav', '25ff38b5300151dd040fd4934e67dc668d3d63a66c4733d9971428116d1b08bc', 537212, 44, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G#2_v1_rr1.wav', 'f5d495c2184e6dacec7783719fbe3f6c1254995abb95ccf307026ef3dd7d5439', 376048, 56, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G#2_v1_rr2.wav', 'a3a5250bc7f561670cd429b0c72ae3b3f3de575d887c69cee48cc7f587be206e', 273224, 56, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G0_v1_rr1.wav', '6c8ed06c816b2aee6443a3df4d8c24dd05d1e6fa72595d47b0e3755cd251e60f', 169640, 31, 0.5, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G0_v1_rr2.wav', '805a41b3a153a8601c9308a106c33604030ff7f3c0c944a92b25663a1baa7873', 240624, 31, 0.5, 2],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G0_v3_rr1.wav', '9dc3c010e20999e524a7694abf27c12fb55296f2d9946d70917fa82b1d076136', 636880, 31, 1, 1],
      ['Strings/Solo Contrabass/Pizz/BKCtbss_Pizz_G0_v3_rr2.wav', '7f64d7d6f6309ab622cc0e070c6d50274f73d3f483e4067a05647fb89a6f51c8', 713924, 31, 1, 2]
    ]
  },
  'timpani': {
    title: 'Timpani, five drums (roots measured: the files are named by drum)', library: 'vsco2-ce', kind: 'oneshot', release: 0.6,
    zones: [
      ['Percussion/Timpani/Timpani1_Hit_v1_rr1_Sum.wav', 'a43d60795e9eab808866c22b6b6b42a64d3a13f6754838f0100a0a1e9a3029cd', 559976, 41.45, 0.5, 1],
      ['Percussion/Timpani/Timpani1_Hit_v1_rr2_Sum.wav', '8f0e0367321f1bfae71f2ef776957ea625d0a48d618fee6f9d42a160222e59c5', 542456, 41.45, 0.5, 2],
      ['Percussion/Timpani/Timpani1_Hit_v3_rr1_Sum.wav', '8b39a785901d08dee14dd89914bdf2201e16ee418965e4d903fdb8e280a14d24', 1602676, 41.45, 1, 1],
      ['Percussion/Timpani/Timpani1_Hit_v3_rr2_Sum.wav', 'ac6ae66048e162024d188f1ea01f6b8b6bd9184d35e164258bab6a383eb7ff93', 2026620, 41.45, 1, 2],
      ['Percussion/Timpani/Timpani2_Hit_v1_rr1_Sum.wav', '19b6e335811edd38d7ecc180d9d6e4adada12ff7a882f83e5153f093a912ae85', 1150296, 46.8, 0.5, 1],
      ['Percussion/Timpani/Timpani2_Hit_v1_rr2_Sum.wav', '702eb08bffe0a8029c2454c7fac6d35a9371d1c9af29e90f38cc00e472a0cfd2', 1325164, 46.8, 0.5, 2],
      ['Percussion/Timpani/Timpani2_Hit_v3_rr1_Sum.wav', '69e5d604effd3f29c86117d22ad2335f73e43f5d47868dc57d8fa593975ee241', 1895164, 46.8, 1, 1],
      ['Percussion/Timpani/Timpani2_Hit_v3_rr2_Sum.wav', '828019517a0475cb9b42d1e40e2cb0a62159f3a9de1d67a5c238f3687e41761e', 1816436, 46.8, 1, 2],
      ['Percussion/Timpani/Timpani3_Hit_v1_rr1_Sum.wav', '00319863ade67b49ec64566eecc801ac7c95e101860b7bb3263f25c7d6757392', 929172, 49.5, 0.5, 1],
      ['Percussion/Timpani/Timpani3_Hit_v1_rr2_Sum.wav', 'cee412e52e189f4b893431a3efc6737b8221efd3c113a4ea9aaeeed57721be23', 1434376, 49.5, 0.5, 2],
      ['Percussion/Timpani/Timpani3_Hit_v3_rr1_Sum.wav', '46cd2ba3798f9e3a6be515b13dbc37d2ef65c82afb0d0e9e34121e4524bfcd3a', 1608252, 49.5, 1, 1],
      ['Percussion/Timpani/Timpani3_Hit_v3_rr2_Sum.wav', '8eb961265ed1e07249dd2fc164f20b82f3e544c3e19ab3c9efef43a51e1c9575', 1474164, 49.5, 1, 2],
      ['Percussion/Timpani/Timpani4_Hit_v1_rr1_Sum.wav', '0c2929ae4fa59e0cbd2a43ee1abb187cce99dc41713bcb012ea71eac39fe6c35', 1183312, 52.4, 0.5, 1],
      ['Percussion/Timpani/Timpani4_Hit_v1_rr2_Sum.wav', 'a9e2679b5fad104b051375c877977a28a75cf1cb04337186c204c8baffc39a11', 751128, 52.4, 0.5, 2],
      ['Percussion/Timpani/Timpani4_Hit_v3_rr1_Sum.wav', '05170757d30297aa680bfbc082c6e438deb1d1d72c5e757610d0b1bbd525968f', 1012976, 52.4, 1, 1],
      ['Percussion/Timpani/Timpani4_Hit_v3_rr2_Sum.wav', 'ff4a34bdf6c98489dbe496c92671020bac7b3e92331f310fc8542085fb75d014', 1278328, 52.4, 1, 2],
      ['Percussion/Timpani/Timpani5_Hit_v1_rr1_Sum.wav', 'c6fc35883ec63df83250b9eb92b05763504a3a484fffad5e82eb95945cab32cf', 327568, 54.6, 0.5, 1],
      ['Percussion/Timpani/Timpani5_Hit_v1_rr2_Sum.wav', '612b09a6c13aaa3e32ce4849564c150001c859a6fad0e1c90e0df79d7509cca1', 262192, 54.6, 0.5, 2],
      ['Percussion/Timpani/Timpani5_Hit_v3_rr1_Sum.wav', 'da8212316bb05e3c06c730d6a67ae4b3c8ed90ca5ec8c52410cb9d0cde1bddb4', 1036528, 54.6, 1, 1],
      ['Percussion/Timpani/Timpani5_Hit_v3_rr2_Sum.wav', 'e1195b473349412495d9c398840dc19b3fb1bf7530b4b85ab78a6d448caa9c40', 986304, 54.6, 1, 2]
    ]
  },
  'glockenspiel': {
    title: 'Glockenspiel, medium mallets', library: 'vsco2-ce', kind: 'oneshot', release: 1.2,
    zones: [
      ['Percussion/Glock/glock_medium_C5.wav', '635f898e0bcb6975b96b18efd9c896f6f1b97ff12174a339ada4814e49675660', 1271310, 84, 1, 1],
      ['Percussion/Glock/glock_medium_C6.wav', 'e942cbf502cf6731df2925945fe3234c876cb63f047d91007b6929887f9e4904', 1271310, 96, 1, 1],
      ['Percussion/Glock/glock_medium_C7.wav', 'b2ecbe0e60c983bbfaa49a1f45f8a11559f7dba27b8c8a032eb2cb7366a36910', 492418, 108, 1, 1],
      ['Percussion/Glock/glock_medium_G4.wav', '6c4649b13e24fa01e4634edad8fe8edf18aef33facc5d49fe53097b376bac4da', 1271310, 79, 1, 1],
      ['Percussion/Glock/glock_medium_G5.wav', '7045c0ef7260e2f1ad11a64406cf7575ed898d1207a91104d33d78caefac63e4', 1226714, 91, 1, 1],
      ['Percussion/Glock/glock_medium_G6.wav', 'a2ba94e59119cd5272c1161fc8b8fbfb94c7b44de45a9a6cc5973b1c332103af', 843122, 103, 1, 1]
    ]
  },
  'shaker': {
    title: 'Shaker (unpitched, eight round robins)', library: 'vsco2-ce', kind: 'oneshot', release: 0.05,
    zones: [
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake1.wav', '025ee4e9e80349cf1d593b02c39e14f17f643fd7f078da49e9b33989c53c0878', 39210, null, 1, 1],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake2.wav', 'cf6d10905a343c3c5229e0f82a8a3312af7636bb271b792d5ae272b248719af4', 40534, null, 1, 2],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake3.wav', '7761b5610372daf5be443be9cde74dee02e3c282f8e2be944ffd624940f4e563', 51852, null, 1, 3],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake4.wav', 'aeb6f7647dd967ccb04402c293db1381e1e04bfe9b76e4a43d4f1484e505d927', 35846, null, 1, 4],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake5.wav', '38188fcdc16f59654d7cf7f990a0d3c864d03fcf26784660ff18ba07935dd815', 35326, null, 1, 5],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake6.wav', '8be70d11d4387823c05c013fee580014eedd44d130760f1cae3847dcbdf646e1', 55446, null, 1, 6],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake7.wav', '316b248bf66c10cceeb32d90d11e38702b68b11758a7e5660a32434697981e33', 48510, null, 1, 7],
      ['VSCO 1 Percussion/varWood/Camo\'s Shaker/shake8.wav', 'dafee38c89998e0d92e8c81f7b5e765949d81718e35b8001686251c2cca0b2ba', 35114, null, 1, 8]
    ]
  },
  'nylon-guitar': {
    title: 'Spanish classical guitar', library: 'freepats-guitar', kind: 'oneshot', release: 0.25,
    zones: [
      ['samples/A#1.flac', 'c00a81011c1a3b1ae44768021f56c1732f49392cb5035b939cbf6a2a6e6d64fc', 302163, 34, 1, 1],
      ['samples/A#3.flac', '41f39ff65aa2ba1ec3db52f17a88970a905cbb9d374c3b3e0e489413f7dc6db5', 65413, 58, 1, 1],
      ['samples/A#4.flac', '2d69375350528ea02dbe078ab4e66bc37da0117ee1969ec8667c21ea770f959c', 67526, 70, 1, 1],
      ['samples/A#5.flac', '7043ece80f1027b712dce4b9b0195893ca74eaef7fab62761bd8dcda7ae37a80', 44256, 82, 1, 1],
      ['samples/A1.flac', '1f1e96a5f182f51bf9cedef97f5c7bcbb5aa1d459b32e320ca650b69eb8c7604', 241760, 33, 1, 1],
      ['samples/A2.flac', '692be630714f59824b612502034b53e9c376374386cb255b81a0bd3c4cdcdd92', 122471, 45, 1, 1],
      ['samples/A3.flac', '08d2e90e80839bdb77342d7dcc8a73e0ec8849607d1a750ce433f9e7f0789e06', 64016, 57, 1, 1],
      ['samples/A4.flac', 'bac918520eb26172cd734e79df9c53fc206e5aab60884583dd7d9ab5b17d16d1', 104527, 69, 1, 1],
      ['samples/A5.flac', 'a0111ff90a40a7d68155803d0708c3c025cc1db44c3e222270c900d56b845a43', 53914, 81, 1, 1],
      ['samples/B1.flac', '28d643b0a8003000b021dddb39b5d7fa260ae3b1690474358a074054ad6fd227', 258837, 35, 1, 1],
      ['samples/B2.flac', 'fa2881b3cbeec65770890b16f74bcec8c0295952292b52ab3ffe95d130c0e879', 94276, 47, 1, 1],
      ['samples/B3.flac', 'eb1c29a7ab345357ef5f783c581adc6a0e3c8164b712c723c1716b906567306a', 61734, 59, 1, 1],
      ['samples/B4.flac', 'ca2b8e768bd7ce5b0037c3645b4c60aeaf077bb128ce3dd8eef98fcd3a36f778', 57831, 71, 1, 1],
      ['samples/B5.flac', '0c417e8aa71eb880d612e298285e78dc9762277a46227f9b04345e8be7d17066', 36008, 83, 1, 1],
      ['samples/C#2.flac', 'de24503cc86d6619cf253443915aa6a1f9629c2ab4c06a256d6ab5d5db9177e4', 233497, 37, 1, 1],
      ['samples/C#4.flac', 'fb19d94abb7a70ff13d4cdd33e27f77dd05f627cf65ee496d0caf1257518bc78', 76764, 61, 1, 1],
      ['samples/C#5.flac', '3004eac9668ec8d8858a54f8962ab6dec25ccc773c4d7d08b2b7d6e2dbb61e3b', 54098, 73, 1, 1],
      ['samples/C2.flac', '6997c7134ce02d437717dc3e279af9f390cefa87aa7f11fa2f350e9b9de50810', 275304, 36, 1, 1],
      ['samples/C3.flac', 'eac0fe1fc03225d81f813667babee072662c101800bc5ad7fb12d9ef3324b986', 97009, 48, 1, 1],
      ['samples/C4.flac', 'e8fcd63c262ebef3e84d1f24242918cc578f8b0db54049ad109815b01d1226f0', 66583, 60, 1, 1],
      ['samples/C5.flac', '84b8a00c7caff015d8b7165330f0c868fd73d300adb3199cb15452841d1c5444', 52003, 72, 1, 1],
      ['samples/C6.flac', '3de4c476b133858e67f701f28caf249598ffd37e25c9aba1301000a345c5293f', 34382, 84, 1, 1],
      ['samples/D#2.flac', '3e0417158950d47e4cc83980966dc4225d9886a96f59563b41b30840b4b7863e', 202512, 39, 1, 1],
      ['samples/D#4.flac', '7df36cee17712043580d868ec292076321e586fac46799c15bc147d9a3f6f0a8', 81425, 63, 1, 1],
      ['samples/D#5.flac', '9fa313d7dd5d00c84947552e0bdcdc9f92be9fd80b68bf0d641b92ead1d99dad', 44669, 75, 1, 1],
      ['samples/D2.flac', '5d98684b41724026109468f8b5ab9489f5bfee1311d3db1aae7d18631e0c0e7c', 172252, 38, 1, 1],
      ['samples/D3.flac', 'c4c08268b1147446afcd7c872355aa71d03822c12fb1b56c7f275617ab2b01a1', 120701, 50, 1, 1],
      ['samples/D4.flac', '1fe411c50d107374e59bc6a89e6513d32f4608783c8be8c36f0b81fdab5dd321', 80992, 62, 1, 1],
      ['samples/D5.flac', '611132fb0b34979c9681a7a4d826a12f36dd678447e83e5689837e4c2e11221d', 47330, 74, 1, 1],
      ['samples/E2.flac', '18ce73f4243991132901b47efe3affa155c1b934d838cf02a29df5c62c8706a8', 122883, 40, 1, 1],
      ['samples/E3.flac', 'f8cc3192a328f10cdb774ff3bf5efb06d1015e64c5ae141c1c31143bb329c915', 109663, 52, 1, 1],
      ['samples/E4.flac', 'b8882fbba2b6a9d0cbae02867be4273aa8f0fddd00bc6f3d993dff6c77997246', 98031, 64, 1, 1],
      ['samples/E5.flac', 'f8323fb0fb66dd655683e1944f0073281e44a6244fdb3f2922851a9cb120bc81', 47804, 76, 1, 1],
      ['samples/F#3.flac', 'e948bee94ac13c463de192d4d03589fe249d2bf425055be0142d6864541d4b59', 100951, 54, 1, 1],
      ['samples/F#4.flac', 'bff470dc100007504ffa6f4e1dc0ced43962b4f37a1904f616e92d09edd636d0', 84744, 66, 1, 1],
      ['samples/F#5.flac', '10c4a73031ad13aba597453053382bce13bc7c4beee6ee845e69ab269857b0b6', 48294, 78, 1, 1],
      ['samples/F2.flac', '12da0a9f876a3feaa2ec8960f13f1465a3da04d662d1bf5518bab97908411c8a', 120165, 41, 1, 1],
      ['samples/F3.flac', 'ea752040ff5373601d41eaf55127b294b5e9f3524f23ddbbd21f1b5edbd0e5ea', 103480, 53, 1, 1],
      ['samples/F4.flac', '8d66344aa2f261aec62d984370a39e479f33398be887df30543430fb5812f1e1', 84382, 65, 1, 1],
      ['samples/F5.flac', 'e4096ad0b1812adf7e3f71f231c18d3c356658cc688f058f5bc05a92e2996a0e', 50703, 77, 1, 1],
      ['samples/G#1.flac', 'cc38eedf15892f79515972192b55889d3c39415caa17f86ef610a1069fc3302c', 304146, 32, 1, 1],
      ['samples/G#3.flac', '47a68a55575dd6159525189ad1bd26e0d66e04d49b5efc0775a3719c31298756', 79319, 56, 1, 1],
      ['samples/G#5.flac', '76c833e28076431b23c21e40ad1348a36ed37b4fa12d90ffccf97dc44ff948dc', 37387, 80, 1, 1],
      ['samples/G1.flac', 'c0821f508a325de97aaba935484705501b972ffeee6d730f20f32cf1705174d9', 327869, 31, 1, 1],
      ['samples/G2.flac', '71e69e5eff738f668b4e3e2f53f72de7725fd3b7969339bb44aba8e7c1df78d2', 122348, 43, 1, 1],
      ['samples/G3.flac', 'd4f3277f48067a3b7e1818b34d08eeec66d727101c744554632397aeb7dd844d', 109718, 55, 1, 1],
      ['samples/G4.flac', '5e3423ab0440fe8cc337ada529c2bb1696914e4465b336d3635630b4ea7b4916', 71824, 67, 1, 1],
      ['samples/G5.flac', '0d887f7f14d526e5af1a1aa7060af92c49e3dc57f1e534c215ce93b8e3f31cc8', 49878, 79, 1, 1]
    ]
  }
};

/** Fetch sets beside each library and instrument name: core is everything the sampled genres use. */
export const SAMPLE_SETS = {
  core: Object.keys(SAMPLED_INSTRUMENTS),
  all: Object.keys(SAMPLED_INSTRUMENTS)
};
