// UI strings. Follow Fontra's display language the same way Fontra does:
// it keeps the language code in localStorage ("fontra-language-language"),
// uses the table for exactly that code, and falls back to English.
//
// Fontra's languages without a table here (currently Tagalog) show English.
// "{0}" in a string is replaced by the first argument of t().

const LANGUAGE_STORAGE_KEY = "fontra-language-language";
const DEFAULT_LANGUAGE = "en";

export const strings = {
  "en": {
    "sidebar.tab": "Stroke font",
    "panel.title": "Stroke font",
    "setting.visible": "Show stroke preview",
    "source.current": "Source: {0}",
    "source.notAtSource":
      "Not at a source: the preview uses the values of the nearest source, “{0}”. " +
      "Go to a source to change its values.",
    "source.noGlyph": "No glyph selected",
    "source.nibGlyph":
      "This glyph is stroked with a pen nib, which is not supported yet.",
    "field.width": "Width",
    "field.cap": "Cap",
    "field.join": "Join",
    "field.miterLimit": "Miter limit",
    "cap.butt": "Butt",
    "cap.round": "Round",
    "cap.square": "Square",
    "join.miter": "Miter",
    "join.round": "Round",
    "join.bevel": "Bevel",
    "undo.width": "Change stroke width",
    "undo.cap": "Change stroke cap",
    "undo.join": "Change stroke join",
    "undo.miterLimit": "Change miter limit",
    "panel.hint":
      "Open contours are centerlines, stroked with these values. Closed contours " +
      "stay as they are. The values belong to the source being edited and are " +
      "saved with the font.",
  },
  "ja": {
    "sidebar.tab": "ストロークフォント",
    "panel.title": "ストロークフォント",
    "setting.visible": "なぞった形を表示",
    "source.current": "ソース: {0}",
    "source.notAtSource":
      "ソースの位置ではありません。表示には一番近いソース「{0}」の値を使っています。" +
      "値を変えるには、ソースの位置に移動してください。",
    "source.noGlyph": "グリフが選択されていません",
    "source.nibGlyph":
      "このグリフはペン先でなぞる設定です。ペン先にはまだ対応していません。",
    "field.width": "太さ",
    "field.cap": "端の形",
    "field.join": "角の形",
    "field.miterLimit": "マイターリミット",
    "cap.butt": "平ら",
    "cap.round": "丸",
    "cap.square": "四角",
    "join.miter": "とがり",
    "join.round": "丸",
    "join.bevel": "切り落とし",
    "undo.width": "太さの変更",
    "undo.cap": "端の形の変更",
    "undo.join": "角の形の変更",
    "undo.miterLimit": "マイターリミットの変更",
    "panel.hint":
      "閉じていない輪郭を中心線として、これらの値でなぞります。閉じた輪郭はそのままです。" +
      "値は編集中のソースのもので、フォントに保存されます。",
  },
  "zh-CN": {
    "sidebar.tab": "笔画字体",
    "panel.title": "笔画字体",
    "setting.visible": "显示笔画预览",
    "source.current": "源: {0}",
    "source.notAtSource":
      "当前不在源的位置: 预览使用最近的源“{0}”的值。要修改数值,请切换到某个源。",
    "source.noGlyph": "未选择字形",
    "source.nibGlyph": "此字形使用笔尖描绘,目前尚不支持。",
    "field.width": "宽度",
    "field.cap": "端点",
    "field.join": "转角",
    "field.miterLimit": "斜接限制",
    "cap.butt": "平头",
    "cap.round": "圆头",
    "cap.square": "方头",
    "join.miter": "斜接",
    "join.round": "圆角",
    "join.bevel": "斜角",
    "undo.width": "修改笔画宽度",
    "undo.cap": "修改笔画端点",
    "undo.join": "修改笔画转角",
    "undo.miterLimit": "修改斜接限制",
    "panel.hint":
      "未闭合的轮廓作为中心线,按这些数值描绘笔画。闭合的轮廓保持不变。" +
      "这些数值属于正在编辑的源,并随字体保存。",
  },
  "zh-TW": {
    "sidebar.tab": "筆畫字型",
    "panel.title": "筆畫字型",
    "setting.visible": "顯示筆畫預覽",
    "source.current": "源: {0}",
    "source.notAtSource":
      "目前不在源的位置: 預覽使用最近的源「{0}」的數值。要修改數值,請切換到某個源。",
    "source.noGlyph": "未選取字符",
    "source.nibGlyph": "此字符使用筆尖描繪,目前尚未支援。",
    "field.width": "寬度",
    "field.cap": "端點",
    "field.join": "轉角",
    "field.miterLimit": "斜接限制",
    "cap.butt": "平頭",
    "cap.round": "圓頭",
    "cap.square": "方頭",
    "join.miter": "斜接",
    "join.round": "圓角",
    "join.bevel": "斜角",
    "undo.width": "修改筆畫寬度",
    "undo.cap": "修改筆畫端點",
    "undo.join": "修改筆畫轉角",
    "undo.miterLimit": "修改斜接限制",
    "panel.hint":
      "未封閉的輪廓作為中心線,依這些數值描繪筆畫。封閉的輪廓保持不變。" +
      "這些數值屬於正在編輯的源,並隨字型儲存。",
  },
  "de": {
    "sidebar.tab": "Strichschrift",
    "panel.title": "Strichschrift",
    "setting.visible": "Strichvorschau anzeigen",
    "source.current": "Source: {0}",
    "source.notAtSource":
      "Nicht an einer Source: Die Vorschau verwendet die Werte der nächsten " +
      "Source „{0}“. Wechsle zu einer Source, um ihre Werte zu ändern.",
    "source.noGlyph": "Keine Glyphe ausgewählt",
    "source.nibGlyph":
      "Diese Glyphe wird mit einer Federspitze gezeichnet, was noch nicht unterstützt wird.",
    "field.width": "Breite",
    "field.cap": "Linienende",
    "field.join": "Ecke",
    "field.miterLimit": "Gehrungsgrenze",
    "cap.butt": "Abgeschnitten",
    "cap.round": "Rund",
    "cap.square": "Überstehend",
    "join.miter": "Gehrung",
    "join.round": "Rund",
    "join.bevel": "Abgeflacht",
    "undo.width": "Strichbreite ändern",
    "undo.cap": "Linienende ändern",
    "undo.join": "Ecke ändern",
    "undo.miterLimit": "Gehrungsgrenze ändern",
    "panel.hint":
      "Offene Konturen sind Mittellinien und werden mit diesen Werten " +
      "nachgezogen. Geschlossene Konturen bleiben, wie sie sind. Die Werte " +
      "gehören zur bearbeiteten Source und werden mit dem Font gespeichert.",
  },
  "nl": {
    "sidebar.tab": "Lijnfont",
    "panel.title": "Lijnfont",
    "setting.visible": "Lijnvoorbeeld tonen",
    "source.current": "Source: {0}",
    "source.notAtSource":
      "Niet op een source: het voorbeeld gebruikt de waarden van de dichtstbijzijnde " +
      "source, ‘{0}’. Ga naar een source om de waarden te wijzigen.",
    "source.noGlyph": "Geen glyph geselecteerd",
    "source.nibGlyph":
      "Deze glyph wordt met een penpunt getrokken; dat wordt nog niet ondersteund.",
    "field.width": "Breedte",
    "field.cap": "Lijnuiteinde",
    "field.join": "Hoek",
    "field.miterLimit": "Verstekgrens",
    "cap.butt": "Recht",
    "cap.round": "Rond",
    "cap.square": "Vierkant",
    "join.miter": "Verstek",
    "join.round": "Rond",
    "join.bevel": "Afgeschuind",
    "undo.width": "Lijnbreedte wijzigen",
    "undo.cap": "Lijnuiteinde wijzigen",
    "undo.join": "Hoek wijzigen",
    "undo.miterLimit": "Verstekgrens wijzigen",
    "panel.hint":
      "Open contouren zijn middenlijnen en worden met deze waarden getrokken. " +
      "Gesloten contouren blijven zoals ze zijn. De waarden horen bij de source " +
      "die je bewerkt en worden met het font opgeslagen.",
  },
  "fr": {
    "sidebar.tab": "Police à traits",
    "panel.title": "Police à traits",
    "setting.visible": "Afficher l’aperçu du trait",
    "source.current": "Source : {0}",
    "source.notAtSource":
      "Pas sur une source : l’aperçu utilise les valeurs de la source la plus " +
      "proche, « {0} ». Placez-vous sur une source pour modifier ses valeurs.",
    "source.noGlyph": "Aucun glyphe sélectionné",
    "source.nibGlyph":
      "Ce glyphe est tracé avec une plume, ce qui n’est pas encore pris en charge.",
    "field.width": "Épaisseur",
    "field.cap": "Extrémité",
    "field.join": "Jointure",
    "field.miterLimit": "Limite de raccord",
    "cap.butt": "Sur la ligne",
    "cap.round": "Arrondie",
    "cap.square": "Carrée",
    "join.miter": "En pointe",
    "join.round": "Arrondie",
    "join.bevel": "Biseautée",
    "undo.width": "Modifier l’épaisseur du trait",
    "undo.cap": "Modifier l’extrémité du trait",
    "undo.join": "Modifier la jointure du trait",
    "undo.miterLimit": "Modifier la limite de raccord",
    "panel.hint":
      "Les contours ouverts sont des lignes médianes, tracées avec ces valeurs. " +
      "Les contours fermés restent tels quels. Les valeurs appartiennent à la " +
      "source en cours d’édition et sont enregistrées avec la police.",
  },
  "it": {
    "sidebar.tab": "Font a tratto",
    "panel.title": "Font a tratto",
    "setting.visible": "Mostra anteprima del tratto",
    "source.current": "Sorgente: {0}",
    "source.notAtSource":
      "Non su una sorgente: l’anteprima usa i valori della sorgente più vicina, " +
      "«{0}». Spostati su una sorgente per modificarne i valori.",
    "source.noGlyph": "Nessun glifo selezionato",
    "source.nibGlyph":
      "Questo glifo è tracciato con un pennino, non ancora supportato.",
    "field.width": "Spessore",
    "field.cap": "Estremità",
    "field.join": "Angolo",
    "field.miterLimit": "Limite di smussatura",
    "cap.butt": "Piatta",
    "cap.round": "Arrotondata",
    "cap.square": "Quadrata",
    "join.miter": "A punta",
    "join.round": "Arrotondato",
    "join.bevel": "Smussato",
    "undo.width": "Modifica spessore del tratto",
    "undo.cap": "Modifica estremità del tratto",
    "undo.join": "Modifica angolo del tratto",
    "undo.miterLimit": "Modifica limite di smussatura",
    "panel.hint":
      "I contorni aperti sono linee centrali, tracciate con questi valori. I " +
      "contorni chiusi restano come sono. I valori appartengono alla sorgente " +
      "in modifica e vengono salvati con il font.",
  },
  "es-ES": {
    "sidebar.tab": "Fuente de trazos",
    "panel.title": "Fuente de trazos",
    "setting.visible": "Mostrar vista previa del trazo",
    "source.current": "Matriz: {0}",
    "source.notAtSource":
      "No estás en una matriz: la vista previa usa los valores de la matriz más " +
      "cercana, «{0}». Ve a una matriz para cambiar sus valores.",
    "source.noGlyph": "Ningún glifo seleccionado",
    "source.nibGlyph":
      "Este glifo se traza con una plumilla, que todavía no es compatible.",
    "field.width": "Grosor",
    "field.cap": "Extremo",
    "field.join": "Esquina",
    "field.miterLimit": "Límite de inglete",
    "cap.butt": "Plano",
    "cap.round": "Redondo",
    "cap.square": "Cuadrado",
    "join.miter": "En punta",
    "join.round": "Redonda",
    "join.bevel": "Biselada",
    "undo.width": "Cambiar grosor del trazo",
    "undo.cap": "Cambiar extremo del trazo",
    "undo.join": "Cambiar esquina del trazo",
    "undo.miterLimit": "Cambiar límite de inglete",
    "panel.hint":
      "Los contornos abiertos son líneas centrales, trazadas con estos valores. " +
      "Los contornos cerrados quedan como están. Los valores pertenecen a la " +
      "matriz que se está editando y se guardan con la tipografía.",
  },
  "es-419": {
    "sidebar.tab": "Fuente de trazos",
    "panel.title": "Fuente de trazos",
    "setting.visible": "Mostrar vista previa del trazo",
    "source.current": "Matriz: {0}",
    "source.notAtSource":
      "No estás en una matriz: la vista previa usa los valores de la matriz más " +
      "cercana, “{0}”. Ve a una matriz para cambiar sus valores.",
    "source.noGlyph": "Ningún glifo seleccionado",
    "source.nibGlyph":
      "Este glifo se traza con una plumilla, que todavía no es compatible.",
    "field.width": "Grosor",
    "field.cap": "Extremo",
    "field.join": "Esquina",
    "field.miterLimit": "Límite de inglete",
    "cap.butt": "Plano",
    "cap.round": "Redondo",
    "cap.square": "Cuadrado",
    "join.miter": "En punta",
    "join.round": "Redonda",
    "join.bevel": "Biselada",
    "undo.width": "Cambiar grosor del trazo",
    "undo.cap": "Cambiar extremo del trazo",
    "undo.join": "Cambiar esquina del trazo",
    "undo.miterLimit": "Cambiar límite de inglete",
    "panel.hint":
      "Los contornos abiertos son líneas centrales, trazadas con estos valores. " +
      "Los contornos cerrados quedan como están. Los valores pertenecen a la " +
      "matriz que se está editando y se guardan con la tipografía.",
  },
  "pt-BR": {
    "sidebar.tab": "Fonte de traços",
    "panel.title": "Fonte de traços",
    "setting.visible": "Mostrar prévia do traço",
    "source.current": "Matriz: {0}",
    "source.notAtSource":
      "Fora de uma matriz: a prévia usa os valores da matriz mais próxima, “{0}”. " +
      "Vá até uma matriz para alterar seus valores.",
    "source.noGlyph": "Nenhum glifo selecionado",
    "source.nibGlyph":
      "Este glifo é traçado com uma pena, o que ainda não é suportado.",
    "field.width": "Espessura",
    "field.cap": "Terminal",
    "field.join": "Canto",
    "field.miterLimit": "Limite de esquadria",
    "cap.butt": "Reto",
    "cap.round": "Arredondado",
    "cap.square": "Quadrado",
    "join.miter": "Em ponta",
    "join.round": "Arredondado",
    "join.bevel": "Chanfrado",
    "undo.width": "Alterar espessura do traço",
    "undo.cap": "Alterar terminal do traço",
    "undo.join": "Alterar canto do traço",
    "undo.miterLimit": "Alterar limite de esquadria",
    "panel.hint":
      "Contornos abertos são linhas centrais, traçadas com estes valores. " +
      "Contornos fechados ficam como estão. Os valores pertencem à matriz em " +
      "edição e são salvos com a tipografia.",
  },
  "pt-PT": {
    "sidebar.tab": "Tipo de traços",
    "panel.title": "Tipo de traços",
    "setting.visible": "Mostrar pré-visualização do traço",
    "source.current": "Matriz: {0}",
    "source.notAtSource":
      "Fora de uma matriz: a pré-visualização usa os valores da matriz mais " +
      "próxima, «{0}». Vá até uma matriz para alterar os seus valores.",
    "source.noGlyph": "Nenhum glifo selecionado",
    "source.nibGlyph":
      "Este glifo é traçado com um aparo, o que ainda não é suportado.",
    "field.width": "Espessura",
    "field.cap": "Terminal",
    "field.join": "Canto",
    "field.miterLimit": "Limite de esquadria",
    "cap.butt": "Reto",
    "cap.round": "Arredondado",
    "cap.square": "Quadrado",
    "join.miter": "Em bico",
    "join.round": "Arredondado",
    "join.bevel": "Chanfrado",
    "undo.width": "Alterar espessura do traço",
    "undo.cap": "Alterar terminal do traço",
    "undo.join": "Alterar canto do traço",
    "undo.miterLimit": "Alterar limite de esquadria",
    "panel.hint":
      "Os contornos abertos são linhas centrais, traçadas com estes valores. " +
      "Os contornos fechados ficam como estão. Os valores pertencem à matriz em " +
      "edição e são guardados com o tipo de letra.",
  },
  "ru": {
    "sidebar.tab": "Штриховой шрифт",
    "panel.title": "Штриховой шрифт",
    "setting.visible": "Показывать обводку",
    "source.current": "Мастер: {0}",
    "source.notAtSource":
      "Не в позиции мастера: для просмотра берутся значения ближайшего " +
      "мастера «{0}». Перейдите к мастеру, чтобы изменить его значения.",
    "source.noGlyph": "Глиф не выбран",
    "source.nibGlyph": "Этот глиф обводится пером, что пока не поддерживается.",
    "field.width": "Толщина",
    "field.cap": "Концы",
    "field.join": "Углы",
    "field.miterLimit": "Предел среза",
    "cap.butt": "Плоские",
    "cap.round": "Круглые",
    "cap.square": "Квадратные",
    "join.miter": "Острые",
    "join.round": "Скруглённые",
    "join.bevel": "Срезанные",
    "undo.width": "Изменение толщины обводки",
    "undo.cap": "Изменение концов обводки",
    "undo.join": "Изменение углов обводки",
    "undo.miterLimit": "Изменение предела среза",
    "panel.hint":
      "Незамкнутые контуры — это средние линии, обводимые с этими значениями. " +
      "Замкнутые контуры остаются как есть. Значения относятся к " +
      "редактируемому мастеру и сохраняются вместе со шрифтом.",
  },
};

export function currentLanguage(storage = safeLocalStorage()) {
  try {
    // Fontra stores string settings as raw (non-JSON) strings
    return storage?.getItem(LANGUAGE_STORAGE_KEY) || DEFAULT_LANGUAGE;
  } catch (e) {
    // localStorage unavailable
    return DEFAULT_LANGUAGE;
  }
}

export function translate(key, language, ...args) {
  const table = strings[language] || strings[DEFAULT_LANGUAGE];
  const text = table[key] ?? strings[DEFAULT_LANGUAGE][key] ?? key;
  return text.replace(/\{(\d+)\}/g, (match, index) =>
    index < args.length ? String(args[index]) : match
  );
}

// Fontra reloads the page when its display language changes, so reading the
// setting on each call is enough to stay in sync.
export function t(key, ...args) {
  return translate(key, currentLanguage(), ...args);
}

function safeLocalStorage() {
  try {
    return globalThis.localStorage;
  } catch (e) {
    return undefined;
  }
}
