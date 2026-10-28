// Emoji set for the picker and :shortcode: autocomplete.
// The full Unicode set (public/emoji.json, made by scripts/build-emoji.mjs) loads in the
// background; until then the short hand-written list below is used.
// Each line: emoji, shortcode, then extra search words (pt/en).

import { signal } from '@angular/core';

export interface EmojiEntry {
  char: string;
  name: string;
  keywords: string;
  /** Other :names: that also work, like :thumbsup: and :+1:. */
  aliases?: string[];
  /** The five skin tones, light to dark. */
  skins?: string[];
}

export interface EmojiCategory {
  id: string;
  label: string;
  icon: string;
  emojis: EmojiEntry[];
}

const RAW: [string, string, string, string][] = [
  [
    'people',
    'Pessoas',
    '😀',
    `😀 grinning sorriso feliz
😃 smiley sorriso
😄 smile sorriso feliz
😁 grin sorrisão
😆 laughing risada rindo
😅 sweat_smile nervoso suor
🤣 rofl rolando de rir
😂 joy chorando de rir kkk
🙂 slight_smile sorriso leve
🙃 upside_down de cabeça para baixo
😉 wink piscadela
😊 blush corado fofo
😇 innocent anjo inocente
🥰 smiling_face_with_3_hearts apaixonado amor
😍 heart_eyes olhos de coração amor
🤩 star_struck estrelas incrível
😘 kissing_heart beijo
😗 kissing beijo
☺️ relaxed sorriso
😚 kissing_closed_eyes beijo
😙 kissing_smiling_eyes beijo
🥲 smiling_face_with_tear emocionado
😋 yum delicia gostoso
😛 stuck_out_tongue lingua
😜 stuck_out_tongue_winking_eye lingua piscando
🤪 zany_face doido maluco
😝 stuck_out_tongue_closed_eyes lingua
🤑 money_mouth dinheiro
🤗 hugging abraço
🤭 face_with_hand_over_mouth ops risadinha
🤫 shushing_face silencio segredo
🤔 thinking pensando hmm
🤐 zipper_mouth boca fechada
🤨 face_with_raised_eyebrow desconfiado
😐 neutral_face neutro
😑 expressionless sem expressão
😶 no_mouth sem boca
😏 smirk sorriso de lado
😒 unamused entediado
🙄 rolling_eyes revirando os olhos
😬 grimacing constrangido
🤥 lying_face mentiroso
😌 relieved aliviado
😔 pensive pensativo triste
😪 sleepy sono
🤤 drooling_face babando
😴 sleeping dormindo zzz
😷 mask mascara doente
🤒 thermometer_face febre doente
🤕 head_bandage machucado
🤢 nauseated_face enjoado
🤮 face_vomiting vomitando
🤧 sneezing_face espirro
🥵 hot_face calor quente
🥶 cold_face frio
🥴 woozy_face tonto bebado
😵 dizzy_face tonto
🤯 exploding_head mente explodindo
🤠 cowboy caubói
🥳 partying_face festa aniversario
😎 sunglasses oculos legal
🤓 nerd
🧐 monocle_face monoculo
😕 confused confuso
😟 worried preocupado
🙁 slight_frown triste
☹️ frowning2 triste
😮 open_mouth surpreso uau
😯 hushed surpreso
😲 astonished espantado
😳 flushed envergonhado corado
🥺 pleading_face pidão por favor
😦 frowning
😧 anguished angustiado
😨 fearful medo
😰 cold_sweat ansioso
😥 disappointed_relieved
😢 cry chorando triste
😭 sob chorando muito
😱 scream grito medo
😖 confounded
😣 persevere
😞 disappointed decepcionado
😓 sweat suor
😩 weary cansado
😫 tired_face exausto
🥱 yawning_face bocejo
😤 triumph bufando
😡 rage furioso raiva
😠 angry bravo raiva
🤬 face_with_symbols_over_mouth palavrão
😈 smiling_imp diabinho
👿 imp diabo
💀 skull caveira morri
☠️ skull_crossbones caveira
💩 poop coco
🤡 clown palhaço
👹 japanese_ogre ogro
👻 ghost fantasma
👽 alien et
🤖 robot robo
😺 smiley_cat gato
😻 heart_eyes_cat gato apaixonado
😹 joy_cat gato rindo
🙈 see_no_evil macaco não vejo
🙉 hear_no_evil macaco
🙊 speak_no_evil macaco
👋 wave tchau oi aceno
🤚 raised_back_of_hand
✋ raised_hand mão
🖖 vulcan
👌 ok_hand ok perfeito
🤌 pinched_fingers italiano
🤏 pinching_hand pouquinho
✌️ v paz vitoria
🤞 fingers_crossed dedos cruzados sorte
🤟 love_you_gesture
🤘 metal rock
🤙 call_me me liga
👈 point_left esquerda
👉 point_right direita
👆 point_up_2 cima
👇 point_down baixo
☝️ point_up
👍 thumbsup joinha positivo like
👎 thumbsdown negativo deslike
✊ fist punho
👊 punch soco
🤛 left_facing_fist
🤜 right_facing_fist
👏 clap palmas aplausos
🙌 raised_hands celebração
👐 open_hands
🤲 palms_up_together
🤝 handshake aperto de mão acordo
🙏 pray por favor obrigado reza
✍️ writing_hand escrevendo
💅 nail_care unha
💪 muscle forte musculo
🧠 brain cerebro
👀 eyes olhos olhando
👁️ eye olho
👅 tongue lingua
👄 lips boca
👶 baby bebe
🧒 child crianca
👦 boy menino
👧 girl menina
🧑 adult pessoa
👨 man homem
👩 woman mulher
🧓 older_adult idoso
👴 older_man vovô
👵 older_woman vovó
🙋 person_raising_hand eu
🤷 person_shrugging sei lá
🤦 person_facepalming facepalm
🙇 person_bowing
💁 person_tipping_hand
🧑‍💻 technologist programador computador
👨‍💻 man_technologist programador
👩‍💻 woman_technologist programadora
🧑‍🍳 cook cozinheiro
🦸 superhero heroi
🧙 mage mago
🧛 vampire vampiro
🧟 zombie zumbi
💃 dancer dançando
🕺 man_dancing dançando
🚶 person_walking andando
🏃 person_running correndo
👪 family familia`,
  ],
  [
    'hearts',
    'Corações e símbolos',
    '❤️',
    `❤️ heart coração amor
🧡 orange_heart coração laranja
💛 yellow_heart coração amarelo
💚 green_heart coração verde
💙 blue_heart coração azul
💜 purple_heart coração roxo
🖤 black_heart coração preto
🤍 white_heart coração branco
🤎 brown_heart coração marrom
💔 broken_heart coração partido
❣️ heart_exclamation
💕 two_hearts corações
💞 revolving_hearts
💓 heartbeat
💗 heartpulse
💖 sparkling_heart
💘 cupid
💝 gift_heart
💯 100 cem perfeito
💢 anger raiva
💥 boom explosão
💫 dizzy
💦 sweat_drops gotas
💨 dash vento rápido
💬 speech_balloon conversa
💭 thought_balloon pensamento
💤 zzz sono
✅ white_check_mark certo ok feito
☑️ ballot_box_with_check
✔️ heavy_check_mark certo
❌ x errado não
❎ negative_squared_cross_mark
❗ exclamation atenção
❓ question pergunta
‼️ bangbang
⁉️ interrobang
⚠️ warning aviso cuidado
🚫 no_entry_sign proibido
⛔ no_entry
🔴 red_circle vermelho
🟠 orange_circle laranja
🟡 yellow_circle amarelo
🟢 green_circle verde
🔵 blue_circle azul
🟣 purple_circle roxo
⚫ black_circle preto
⚪ white_circle branco
⭐ star estrela
🌟 star2 estrela brilhante
✨ sparkles brilho
⚡ zap raio energia
🔥 fire fogo
🎵 musical_note música
🎶 notes música
➕ heavy_plus_sign mais
➖ heavy_minus_sign menos
➡️ arrow_right seta
⬅️ arrow_left seta
⬆️ arrow_up seta
⬇️ arrow_down seta
🔁 repeat repetir
🆗 ok
🆕 new novo
🆒 cool
🆘 sos socorro
♻️ recycle reciclar
©️ copyright
®️ registered
™️ tm`,
  ],
  [
    'nature',
    'Animais e natureza',
    '🐶',
    `🐶 dog cachorro
🐱 cat gato
🐭 mouse rato
🐹 hamster
🐰 rabbit coelho
🦊 fox raposa
🐻 bear urso
🐼 panda
🐨 koala coala
🐯 tiger tigre
🦁 lion leão
🐮 cow vaca
🐷 pig porco
🐸 frog sapo
🐵 monkey_face macaco
🐔 chicken galinha
🐧 penguin pinguim
🐦 bird passaro
🐤 baby_chick pintinho
🦆 duck pato
🦅 eagle aguia
🦉 owl coruja
🦇 bat morcego
🐺 wolf lobo
🐗 boar javali
🐴 horse cavalo
🦄 unicorn unicornio
🐝 bee abelha
🐛 bug inseto
🦋 butterfly borboleta
🐌 snail caracol
🐞 lady_beetle joaninha
🐜 ant formiga
🕷️ spider aranha
🦂 scorpion escorpião
🐢 turtle tartaruga
🐍 snake cobra
🦎 lizard lagarto
🦖 t_rex dinossauro
🐙 octopus polvo
🦑 squid lula
🦀 crab caranguejo
🐠 tropical_fish peixe
🐟 fish peixe
🐬 dolphin golfinho
🐳 whale baleia
🦈 shark tubarão
🐊 crocodile jacaré
🐘 elephant elefante
🦒 giraffe girafa
🐕 dog2 cachorro
🐈 cat2 gato
🦜 parrot papagaio
🦥 sloth preguiça
🌵 cactus cacto
🎄 christmas_tree arvore de natal
🌲 evergreen_tree pinheiro
🌳 deciduous_tree arvore
🌴 palm_tree coqueiro praia
🌱 seedling broto
🌿 herb planta
🍀 four_leaf_clover trevo sorte
🍁 maple_leaf folha
🍂 fallen_leaf outono
🌷 tulip tulipa flor
🌹 rose rosa flor
🌻 sunflower girassol
🌸 cherry_blossom flor
🌼 blossom flor
💐 bouquet buque
🌞 sun_with_face sol
🌝 full_moon_with_face lua
🌙 crescent_moon lua
🌎 earth_americas terra mundo
🪐 ringed_planet planeta
☀️ sunny sol
⛅ partly_sunny nublado
☁️ cloud nuvem
🌧️ cloud_rain chuva
⛈️ thunder_cloud_rain tempestade
❄️ snowflake neve floco
☃️ snowman2 boneco de neve
🌈 rainbow arco-iris
☔ umbrella guarda-chuva
🌊 ocean onda mar`,
  ],
  [
    'food',
    'Comidas e bebidas',
    '🍔',
    `🍏 green_apple maçã verde
🍎 apple maçã
🍐 pear pera
🍊 tangerine laranja
🍋 lemon limão
🍌 banana
🍉 watermelon melancia
🍇 grapes uva
🍓 strawberry morango
🫐 blueberries mirtilo
🍈 melon melão
🍒 cherries cereja
🍑 peach pessego
🥭 mango manga
🍍 pineapple abacaxi
🥥 coconut coco
🥝 kiwi
🍅 tomato tomate
🥑 avocado abacate
🍆 eggplant berinjela
🥔 potato batata
🥕 carrot cenoura
🌽 corn milho
🌶️ hot_pepper pimenta
🥦 broccoli brocolis
🧄 garlic alho
🧅 onion cebola
🍄 mushroom cogumelo
🥜 peanuts amendoim
🍞 bread pão
🥐 croissant
🧀 cheese queijo
🥚 egg ovo
🍳 cooking ovo frito
🥓 bacon
🥩 cut_of_meat carne churrasco
🍗 poultry_leg frango
🍖 meat_on_bone carne
🌭 hotdog cachorro-quente
🍔 hamburger hamburguer
🍟 fries batata frita
🍕 pizza
🥪 sandwich sanduiche
🌮 taco
🌯 burrito
🥗 salad salada
🍝 spaghetti macarrão
🍜 ramen lamen
🍣 sushi
🍤 fried_shrimp camarão
🍚 rice arroz
🍦 icecream sorvete
🍩 doughnut rosquinha
🍪 cookie biscoito
🎂 birthday bolo aniversario
🍰 cake bolo
🧁 cupcake
🍫 chocolate_bar chocolate
🍬 candy bala doce
🍭 lollipop pirulito
🍿 popcorn pipoca
☕ coffee café
🍵 tea chá
🧃 beverage_box suco
🥤 cup_with_straw refrigerante
🧋 bubble_tea
🍺 beer cerveja
🍻 beers cerveja brinde
🥂 champagne_glass brinde
🍷 wine_glass vinho
🥃 tumbler_glass whisky
🍸 cocktail drink
🍹 tropical_drink caipirinha
🧉 mate chimarrão tereré
🍾 champagne
🧊 ice_cube gelo`,
  ],
  [
    'activities',
    'Atividades',
    '⚽',
    `⚽ soccer futebol bola
🏀 basketball basquete
🏈 football futebol americano
⚾ baseball beisebol
🎾 tennis tênis
🏐 volleyball vôlei
🏉 rugby_football rugby
🎱 8ball sinuca
🏓 ping_pong pingue-pongue
🏸 badminton
🥊 boxing_glove boxe
🥋 martial_arts_uniform jiu-jitsu
🛹 skateboard skate
⛸️ ice_skate patins
🎿 ski esqui
🏆 trophy troféu campeão
🥇 first_place_medal ouro primeiro
🥈 second_place_medal prata
🥉 third_place_medal bronze
🏅 medal medalha
🎖️ military_medal
🎗️ reminder_ribbon
🎫 ticket ingresso
🎟️ tickets ingressos
🎪 circus_tent circo
🎭 performing_arts teatro
🎨 art arte pintura
🎬 clapper cinema filme
🎤 microphone microfone karaoke
🎧 headphones fone musica
🎼 musical_score
🎹 musical_keyboard piano
🥁 drum bateria tambor
🎷 saxophone saxofone
🎺 trumpet trompete
🎸 guitar violão guitarra
🎻 violin violino
🎲 game_die dado
♟️ chess_pawn xadrez
🎯 dart alvo
🎳 bowling boliche
🎮 video_game videogame jogo controle
🕹️ joystick
🧩 jigsaw quebra-cabeça
🎉 tada festa comemoração parabéns
🎊 confetti_ball confete
🎈 balloon balão
🎁 gift presente
🎀 ribbon laço
🎃 jack_o_lantern abobora halloween
🎆 fireworks fogos
🎇 sparkler`,
  ],
  [
    'travel',
    'Viagens e lugares',
    '🚗',
    `🚗 red_car carro
🚕 taxi táxi
🚙 blue_car carro
🚌 bus ônibus
🏎️ race_car corrida
🚓 police_car polícia
🚑 ambulance ambulância
🚒 fire_engine bombeiro
🚚 truck caminhão
🚜 tractor trator
🏍️ motorcycle moto
🛵 motor_scooter
🚲 bike bicicleta
🛴 scooter patinete
🚨 rotating_light sirene alerta
🚦 vertical_traffic_light semaforo
🛑 octagonal_sign pare
✈️ airplane avião viagem
🛫 airplane_departure
🛬 airplane_arriving
🚀 rocket foguete
🛸 flying_saucer disco voador
🚁 helicopter helicóptero
⛵ sailboat barco
🚤 speedboat lancha
🚢 ship navio
⚓ anchor ancora
🚂 steam_locomotive trem
🚇 metro metrô
🗺️ map mapa
🗽 statue_of_liberty
🏰 european_castle castelo
🎡 ferris_wheel roda gigante
🎢 roller_coaster montanha russa
🏖️ beach praia
🏝️ island ilha
🏜️ desert deserto
🌋 volcano vulcão
⛰️ mountain montanha
🏕️ camping acampamento
🏠 house casa
🏡 house_with_garden casa
🏢 office escritório prédio
🏥 hospital
🏦 bank banco
🏨 hotel
🏪 convenience_store loja
🏫 school escola
⛪ church igreja
🌆 city_dusk cidade
🌃 night_with_stars noite
🌉 bridge_at_night ponte`,
  ],
  [
    'objects',
    'Objetos',
    '💡',
    `⌚ watch relógio
📱 mobile_phone celular
💻 computer computador notebook
⌨️ keyboard teclado
🖥️ desktop monitor
🖨️ printer impressora
🖱️ mouse_three_button mouse
💾 floppy_disk disquete salvar
💿 cd
📷 camera câmera foto
📸 camera_with_flash foto
📹 video_camera filmadora
🎥 movie_camera
📞 telephone_receiver telefone
☎️ telephone
📺 tv televisão
📻 radio rádio
⏰ alarm_clock despertador
⌛ hourglass ampulheta
⏳ hourglass_flowing_sand esperando
🔋 battery bateria
🔌 electric_plug tomada
💡 bulb ideia lâmpada
🔦 flashlight lanterna
🕯️ candle vela
💸 money_with_wings dinheiro voando
💵 dollar dinheiro
💰 moneybag saco de dinheiro
💳 credit_card cartão
💎 gem diamante
⚖️ scales balança
🔧 wrench chave
🔨 hammer martelo
🛠️ tools ferramentas
⚙️ gear engrenagem configuração
🔩 nut_and_bolt
🧲 magnet ímã
🔫 gun pistola água
💣 bomb bomba
🔪 knife faca
🛡️ shield escudo
🔮 crystal_ball bola de cristal
💊 pill remédio
💉 syringe vacina
🧪 test_tube
🌡️ thermometer termômetro
🧹 broom vassoura
🚽 toilet banheiro
🛏️ bed cama
🛋️ couch sofá
🚪 door porta
🔑 key chave
🗝️ key2
🔒 lock cadeado
🔓 unlock
📦 package pacote caixa
📫 mailbox correio
✉️ envelope carta email
📧 e_mail email
📝 pencil anotação
✏️ pencil2 lápis
🖊️ pen caneta
📌 pushpin alfinete fixar
📎 paperclip clipe anexo
📏 straight_ruler régua
📁 file_folder pasta
📅 date calendário data
📆 calendar_spiral
📊 bar_chart gráfico
📈 chart_with_upwards_trend subindo alta
📉 chart_with_downwards_trend descendo baixa
📋 clipboard prancheta
📚 books livros estudo
📖 book livro
🔔 bell sino notificação
🔕 no_bell silencio
📣 mega megafone
📢 loudspeaker anuncio
🔍 mag lupa pesquisar
🏷️ label etiqueta`,
  ],
  [
    'flags',
    'Bandeiras',
    '🏁',
    `🏁 checkered_flag chegada
🚩 triangular_flag_on_post bandeira
🏳️ white_flag rendição
🏴 black_flag
🏳️‍🌈 rainbow_flag lgbt orgulho
🇧🇷 flag_br brasil
🇵🇹 flag_pt portugal
🇺🇸 flag_us estados unidos eua
🇦🇷 flag_ar argentina
🇺🇾 flag_uy uruguai
🇵🇾 flag_py paraguai
🇨🇱 flag_cl chile
🇲🇽 flag_mx mexico
🇨🇦 flag_ca canadá
🇬🇧 flag_gb inglaterra reino unido
🇪🇸 flag_es espanha
🇫🇷 flag_fr frança
🇮🇹 flag_it itália
🇩🇪 flag_de alemanha
🇯🇵 flag_jp japão
🇨🇳 flag_cn china
🇰🇷 flag_kr coreia
🇦🇴 flag_ao angola
🇲🇿 flag_mz moçambique`,
  ],
];

const BUILT_IN: EmojiCategory[] = RAW.map(([id, label, icon, body]) => ({
  id,
  label,
  icon,
  emojis: body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [char, name, ...rest] = line.split(' ');
      return { char, name, keywords: (name.replace(/_/g, ' ') + ' ' + rest.join(' ')).toLowerCase() };
    }),
}));

/** The picker's categories: the built-in list, then every emoji once emoji.json arrives. */
export const emojiCategories = signal<EmojiCategory[]>(BUILT_IN);

let all: EmojiEntry[] = [];
let byName = new Map<string, string>();
/** Any form of an emoji (skin tone, with or without U+FE0F) → its entry. */
let byChar = new Map<string, EmojiEntry>();

function index(cats: EmojiCategory[]) {
  all = cats.flatMap((c) => c.emojis);
  byName = new Map();
  byChar = new Map();
  for (const e of all) {
    for (const n of [e.name, ...(e.aliases ?? [])]) if (!byName.has(n)) byName.set(n, e.char);
    for (const c of [e.char, ...(e.skins ?? [])]) byChar.set(c.replace(/\uFE0F/g, ''), e);
  }
}
index(BUILT_IN);

let loading: Promise<void> | null = null;

/** Fetches the full emoji set once (the browser caches it). */
export function loadEmojis(): Promise<void> {
  loading ??= fetch('/emoji.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((d: { categories: { id: string; label: string; icon: string; emojis: [string, string, string, string, string[]?][] }[] }) => {
      const cats = d.categories.map((c) => ({
        id: c.id,
        label: c.label,
        icon: c.icon,
        emojis: c.emojis.map(([char, name, aliases, words, skins]) => ({
          char,
          name,
          aliases: aliases ? aliases.split(' ') : [],
          keywords: `${name.replace(/_/g, ' ')} ${aliases.replace(/_/g, ' ')} ${words}`,
          skins,
        })),
      }));
      index(cats);
      emojiCategories.set(cats);
    })
    .catch((e) => {
      console.warn('emoji list failed to load', e);
      loading = null;
    });
  return loading;
}

/** The emoji in the chosen skin tone (0 = default yellow, 1–5 light to dark). */
export function withSkin(e: EmojiEntry, tone: number): string {
  return tone > 0 && e.skins ? e.skins[tone - 1] : e.char;
}

/** The entry for an emoji character, in any skin tone. */
export function emojiEntry(char: string): EmojiEntry | undefined {
  return byChar.get(char.replace(/\uFE0F/g, ''));
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function searchEmojis(q: string, limit = 60): EmojiEntry[] {
  const n = normalize(q.trim());
  if (!n) return [];
  const starts: EmojiEntry[] = [];
  const contains: EmojiEntry[] = [];
  for (const e of all) {
    if (normalize(e.name).startsWith(n) || e.aliases?.some((a) => a.startsWith(n))) starts.push(e);
    else if (normalize(e.keywords).includes(n)) contains.push(e);
  }
  return [...starts, ...contains].slice(0, limit);
}

/** The emoji for a :shortcode: name ("joy" → 😂), if there is one. */
export function shortcodeEmoji(name: string): string | undefined {
  return byName.get(name);
}
