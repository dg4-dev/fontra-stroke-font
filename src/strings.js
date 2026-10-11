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
    "setting.outlineOnly": "Draw the edge only",
    "setting.fillOpacity": "Fill opacity",
    "setting.otherGlyphs": "Show strokes on the other glyphs",
    "source.between": "Between sources",
    "source.notAtSource":
      "Between sources: the preview uses values interpolated between the sources. Go to a source to change its values.",
    "source.sharedStyle":
      "Cap and join are the same in all sources; they are saved in the default source, “{0}”.",
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
    "field.left": "Left",
    "field.right": "Right",
    "point.sourceValue": "Source’s",
    "points.title": "Selected points: {0}",
    "points.noneTitle": "Points",
    "points.none":
      "Select points of a centerline to give them their own widths. A point in the middle without a width of its own follows the points around it.",
    "points.sharedJoin":
      "Point joins are the same in all sources; they are saved in the default source, “{0}”.",
    "points.clear": "Clear point values",
    "undo.pointWidth": "Change point width",
    "undo.pointJoin": "Change point join",
    "undo.pointMiterLimit": "Change point miter limit",
    "undo.pointClear": "Clear point values",
    "tool.title": "Stroke widths: drag the handles on the edges of points",
    "setting.handles": "Show width handles (stroke width tool)",
    "menu.pointJoin": "Join of the point",
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
    "setting.outlineOnly": "縁だけを表示",
    "setting.fillOpacity": "塗りの濃さ",
    "setting.otherGlyphs": "編集中以外のグリフもなぞって表示",
    "source.between": "ソースの間",
    "source.notAtSource":
      "ソースの位置ではありません。表示には、ソースの値を補間した値を使っています。値を変えるには、ソースの位置に移動してください。",
    "source.sharedStyle":
      "端の形と角の形は全ソース共通で、デフォルトソース「{0}」に保存されます。",
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
    "field.left": "左",
    "field.right": "右",
    "point.sourceValue": "ソースの値",
    "points.title": "選択中の点: {0}",
    "points.noneTitle": "点",
    "points.none":
      "中心線の点を選ぶと、点ごとの太さを付けられます。途中の点で値が無いものは、前後の点に合わせた太さになります。",
    "points.sharedJoin":
      "点ごとの角の形は全ソース共通で、デフォルトソース「{0}」に保存されます。",
    "points.clear": "点の値を消す",
    "undo.pointWidth": "点の太さの変更",
    "undo.pointJoin": "点の角の形の変更",
    "undo.pointMiterLimit": "点のマイターリミットの変更",
    "undo.pointClear": "点の値の消去",
    "tool.title": "ストロークの太さ（点の縁のハンドルをドラッグ）",
    "setting.handles": "太さのハンドルを表示（太さのツール）",
    "menu.pointJoin": "点の角の形",
    "panel.hint":
      "閉じていない輪郭を中心線として、これらの値でなぞります。閉じた輪郭はそのままです。" +
      "値は編集中のソースのもので、フォントに保存されます。",
  },
  "zh-CN": {
    "sidebar.tab": "笔画字体",
    "panel.title": "笔画字体",
    "setting.visible": "显示笔画预览",
    "source.current": "源: {0}",
    "setting.outlineOnly": "仅显示边缘",
    "setting.fillOpacity": "填充不透明度",
    "setting.otherGlyphs": "在其他字形上也显示笔画",
    "source.between": "源之间",
    "source.notAtSource":
      "当前不在源的位置: 预览使用各源数值的插值。要修改数值,请切换到某个源。",
    "source.sharedStyle": "端点和转角在所有源中相同,保存在默认源“{0}”中。",
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
    "field.left": "左侧",
    "field.right": "右侧",
    "point.sourceValue": "源的值",
    "points.title": "选中的点: {0}",
    "points.noneTitle": "点",
    "points.none":
      "选择中心线上的点,即可为其设置单独的宽度。中间没有自身宽度的点会随前后的点变化。",
    "points.sharedJoin": "点的转角在所有源中相同,保存在默认源“{0}”中。",
    "points.clear": "清除点的值",
    "undo.pointWidth": "修改点的宽度",
    "undo.pointJoin": "修改点的转角",
    "undo.pointMiterLimit": "修改点的斜接限制",
    "undo.pointClear": "清除点的值",
    "tool.title": "笔画宽度(拖动点边缘的手柄)",
    "setting.handles": "显示宽度手柄(笔画宽度工具)",
    "menu.pointJoin": "点的转角",
    "panel.hint":
      "未闭合的轮廓作为中心线,按这些数值描绘笔画。闭合的轮廓保持不变。" +
      "这些数值属于正在编辑的源,并随字体保存。",
  },
  "zh-TW": {
    "sidebar.tab": "筆畫字型",
    "panel.title": "筆畫字型",
    "setting.visible": "顯示筆畫預覽",
    "source.current": "源: {0}",
    "setting.outlineOnly": "僅顯示邊緣",
    "setting.fillOpacity": "填色不透明度",
    "setting.otherGlyphs": "在其他字符上也顯示筆畫",
    "source.between": "源之間",
    "source.notAtSource":
      "目前不在源的位置: 預覽使用各源數值的內插值。要修改數值,請切換到某個源。",
    "source.sharedStyle": "端點和轉角在所有源中相同,儲存在預設源「{0}」中。",
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
    "field.left": "左側",
    "field.right": "右側",
    "point.sourceValue": "源的值",
    "points.title": "選取的點: {0}",
    "points.noneTitle": "點",
    "points.none":
      "選取中心線上的點,即可為其設定個別的寬度。中間沒有自身寬度的點會隨前後的點變化。",
    "points.sharedJoin": "點的轉角在所有源中相同,儲存在預設源「{0}」中。",
    "points.clear": "清除點的值",
    "undo.pointWidth": "修改點的寬度",
    "undo.pointJoin": "修改點的轉角",
    "undo.pointMiterLimit": "修改點的斜接限制",
    "undo.pointClear": "清除點的值",
    "tool.title": "筆畫寬度(拖曳點邊緣的控點)",
    "setting.handles": "顯示寬度控點(筆畫寬度工具)",
    "menu.pointJoin": "點的轉角",
    "panel.hint":
      "未封閉的輪廓作為中心線,依這些數值描繪筆畫。封閉的輪廓保持不變。" +
      "這些數值屬於正在編輯的源,並隨字型儲存。",
  },
  "de": {
    "sidebar.tab": "Strichschrift",
    "panel.title": "Strichschrift",
    "setting.visible": "Strichvorschau anzeigen",
    "source.current": "Source: {0}",
    "setting.outlineOnly": "Nur den Rand zeichnen",
    "setting.fillOpacity": "Deckkraft der Füllung",
    "setting.otherGlyphs": "Striche auch auf den anderen Glyphen zeigen",
    "source.between": "Zwischen Sources",
    "source.notAtSource":
      "Nicht an einer Source: Die Vorschau verwendet zwischen den Sources interpolierte Werte. Wechsle zu einer Source, um ihre Werte zu ändern.",
    "source.sharedStyle":
      "Linienende und Ecke gelten für alle Sources und werden in der Standard-Source „{0}“ gespeichert.",
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
    "field.left": "Links",
    "field.right": "Rechts",
    "point.sourceValue": "Wert der Source",
    "points.title": "Ausgewählte Punkte: {0}",
    "points.noneTitle": "Punkte",
    "points.none":
      "Wähle Punkte einer Mittellinie aus, um ihnen eigene Breiten zu geben. Ein Punkt in der Mitte ohne eigene Breite folgt den Punkten um ihn herum.",
    "points.sharedJoin":
      "Die Ecken der Punkte sind in allen Sources gleich; sie werden in der Standard-Source „{0}“ gespeichert.",
    "points.clear": "Punktwerte löschen",
    "undo.pointWidth": "Punktbreite ändern",
    "undo.pointJoin": "Punktecke ändern",
    "undo.pointMiterLimit": "Gehrungsgrenze des Punkts ändern",
    "undo.pointClear": "Punktwerte löschen",
    "tool.title": "Strichbreiten: Anfasser an den Kanten der Punkte ziehen",
    "setting.handles": "Breitenanfasser anzeigen (Strichbreiten-Werkzeug)",
    "menu.pointJoin": "Ecke des Punkts",
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
    "setting.outlineOnly": "Alleen de rand tekenen",
    "setting.fillOpacity": "Dekking van de vulling",
    "setting.otherGlyphs": "Lijnen ook op de andere glyphs tonen",
    "source.between": "Tussen sources",
    "source.notAtSource":
      "Niet op een source: het voorbeeld gebruikt waarden die tussen de sources geïnterpoleerd zijn. Ga naar een source om de waarden te wijzigen.",
    "source.sharedStyle":
      "Lijnuiteinde en hoek zijn in alle sources gelijk en worden opgeslagen in de standaardsource ‘{0}’.",
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
    "field.left": "Links",
    "field.right": "Rechts",
    "point.sourceValue": "Waarde van de source",
    "points.title": "Geselecteerde punten: {0}",
    "points.noneTitle": "Punten",
    "points.none":
      "Selecteer punten van een middellijn om ze een eigen breedte te geven. Een punt in het midden zonder eigen breedte volgt de punten eromheen.",
    "points.sharedJoin":
      "De hoeken van punten zijn in alle sources gelijk; ze worden opgeslagen in de standaardsource ‘{0}’.",
    "points.clear": "Puntwaarden wissen",
    "undo.pointWidth": "Puntbreedte wijzigen",
    "undo.pointJoin": "Punthoek wijzigen",
    "undo.pointMiterLimit": "Verstekgrens van punt wijzigen",
    "undo.pointClear": "Puntwaarden wissen",
    "tool.title": "Lijnbreedtes: sleep de grepen aan de randen van punten",
    "setting.handles": "Breedtegrepen tonen (lijnbreedtegereedschap)",
    "menu.pointJoin": "Hoek van het punt",
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
    "setting.outlineOnly": "Dessiner seulement le contour",
    "setting.fillOpacity": "Opacité du remplissage",
    "setting.otherGlyphs": "Afficher les traits sur les autres glyphes",
    "source.between": "Entre les sources",
    "source.notAtSource":
      "Pas sur une source : l’aperçu utilise des valeurs interpolées entre les sources. Placez-vous sur une source pour modifier ses valeurs.",
    "source.sharedStyle":
      "L’extrémité et la jointure sont les mêmes pour toutes les sources ; elles sont enregistrées dans la source par défaut, « {0} ».",
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
    "field.left": "Gauche",
    "field.right": "Droite",
    "point.sourceValue": "Valeur de la source",
    "points.title": "Points sélectionnés : {0}",
    "points.noneTitle": "Points",
    "points.none":
      "Sélectionnez des points d’une ligne centrale pour leur donner leur propre épaisseur. Un point au milieu sans épaisseur propre suit les points qui l’entourent.",
    "points.sharedJoin":
      "Les jointures des points sont les mêmes dans toutes les sources ; elles sont enregistrées dans la source par défaut, « {0} ».",
    "points.clear": "Effacer les valeurs des points",
    "undo.pointWidth": "Modifier l’épaisseur du point",
    "undo.pointJoin": "Modifier la jointure du point",
    "undo.pointMiterLimit": "Modifier la limite de raccord du point",
    "undo.pointClear": "Effacer les valeurs des points",
    "tool.title":
      "Épaisseurs du trait : faites glisser les poignées sur les bords des points",
    "setting.handles": "Afficher les poignées d’épaisseur (outil d’épaisseur)",
    "menu.pointJoin": "Jointure du point",
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
    "setting.outlineOnly": "Disegna solo il bordo",
    "setting.fillOpacity": "Opacità del riempimento",
    "setting.otherGlyphs": "Mostra i tratti anche sugli altri glifi",
    "source.between": "Tra le sorgenti",
    "source.notAtSource":
      "Non su una sorgente: l’anteprima usa valori interpolati tra le sorgenti. Spostati su una sorgente per modificarne i valori.",
    "source.sharedStyle":
      "Estremità e angolo sono uguali in tutte le sorgenti e vengono salvati nella sorgente predefinita, «{0}».",
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
    "field.left": "Sinistra",
    "field.right": "Destra",
    "point.sourceValue": "Valore della sorgente",
    "points.title": "Punti selezionati: {0}",
    "points.noneTitle": "Punti",
    "points.none":
      "Seleziona i punti di una linea centrale per dare loro uno spessore proprio. Un punto in mezzo senza spessore proprio segue i punti intorno.",
    "points.sharedJoin":
      "Gli angoli dei punti sono uguali in tutte le sorgenti; vengono salvati nella sorgente predefinita, «{0}».",
    "points.clear": "Cancella i valori dei punti",
    "undo.pointWidth": "Modifica spessore del punto",
    "undo.pointJoin": "Modifica angolo del punto",
    "undo.pointMiterLimit": "Modifica limite di smussatura del punto",
    "undo.pointClear": "Cancella i valori dei punti",
    "tool.title": "Spessori del tratto: trascina le maniglie sui bordi dei punti",
    "setting.handles": "Mostra le maniglie dello spessore (strumento spessore)",
    "menu.pointJoin": "Angolo del punto",
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
    "setting.outlineOnly": "Dibujar solo el borde",
    "setting.fillOpacity": "Opacidad del relleno",
    "setting.otherGlyphs": "Mostrar los trazos en los demás glifos",
    "source.between": "Entre matrices",
    "source.notAtSource":
      "No estás en una matriz: la vista previa usa valores interpolados entre las matrices. Ve a una matriz para cambiar sus valores.",
    "source.sharedStyle":
      "El extremo y la esquina son iguales en todas las matrices y se guardan en la matriz predeterminada, «{0}».",
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
    "field.left": "Izquierda",
    "field.right": "Derecha",
    "point.sourceValue": "Valor de la matriz",
    "points.title": "Puntos seleccionados: {0}",
    "points.noneTitle": "Puntos",
    "points.none":
      "Selecciona puntos de una línea central para darles su propio grosor. Un punto intermedio sin grosor propio sigue a los puntos que lo rodean.",
    "points.sharedJoin":
      "Las esquinas de los puntos son iguales en todas las matrices y se guardan en la matriz predeterminada, «{0}».",
    "points.clear": "Borrar los valores de los puntos",
    "undo.pointWidth": "Cambiar grosor del punto",
    "undo.pointJoin": "Cambiar esquina del punto",
    "undo.pointMiterLimit": "Cambiar límite de inglete del punto",
    "undo.pointClear": "Borrar los valores de los puntos",
    "tool.title":
      "Grosores del trazo: arrastra los tiradores de los bordes de los puntos",
    "setting.handles": "Mostrar tiradores de grosor (herramienta de grosor)",
    "menu.pointJoin": "Esquina del punto",
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
    "setting.outlineOnly": "Dibujar solo el borde",
    "setting.fillOpacity": "Opacidad del relleno",
    "setting.otherGlyphs": "Mostrar los trazos en los demás glifos",
    "source.between": "Entre matrices",
    "source.notAtSource":
      "No estás en una matriz: la vista previa usa valores interpolados entre las matrices. Ve a una matriz para cambiar sus valores.",
    "source.sharedStyle":
      "El extremo y la esquina son iguales en todas las matrices y se guardan en la matriz predeterminada, “{0}”.",
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
    "field.left": "Izquierda",
    "field.right": "Derecha",
    "point.sourceValue": "Valor de la matriz",
    "points.title": "Puntos seleccionados: {0}",
    "points.noneTitle": "Puntos",
    "points.none":
      "Selecciona puntos de una línea central para darles su propio grosor. Un punto intermedio sin grosor propio sigue a los puntos que lo rodean.",
    "points.sharedJoin":
      "Las esquinas de los puntos son iguales en todas las matrices y se guardan en la matriz predeterminada, “{0}”.",
    "points.clear": "Borrar los valores de los puntos",
    "undo.pointWidth": "Cambiar grosor del punto",
    "undo.pointJoin": "Cambiar esquina del punto",
    "undo.pointMiterLimit": "Cambiar límite de inglete del punto",
    "undo.pointClear": "Borrar los valores de los puntos",
    "tool.title":
      "Grosores del trazo: arrastra los tiradores de los bordes de los puntos",
    "setting.handles": "Mostrar tiradores de grosor (herramienta de grosor)",
    "menu.pointJoin": "Esquina del punto",
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
    "setting.outlineOnly": "Desenhar só a borda",
    "setting.fillOpacity": "Opacidade do preenchimento",
    "setting.otherGlyphs": "Mostrar os traços nos outros glifos",
    "source.between": "Entre matrizes",
    "source.notAtSource":
      "Fora de uma matriz: a prévia usa valores interpolados entre as matrizes. Vá até uma matriz para alterar seus valores.",
    "source.sharedStyle":
      "Terminal e canto são iguais em todas as matrizes e ficam salvos na matriz padrão, “{0}”.",
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
    "field.left": "Esquerda",
    "field.right": "Direita",
    "point.sourceValue": "Valor da matriz",
    "points.title": "Pontos selecionados: {0}",
    "points.noneTitle": "Pontos",
    "points.none":
      "Selecione pontos de uma linha central para dar a eles uma espessura própria. Um ponto no meio sem espessura própria segue os pontos ao redor.",
    "points.sharedJoin":
      "Os cantos dos pontos são iguais em todas as matrizes e são salvos na matriz padrão, “{0}”.",
    "points.clear": "Limpar os valores dos pontos",
    "undo.pointWidth": "Alterar espessura do ponto",
    "undo.pointJoin": "Alterar canto do ponto",
    "undo.pointMiterLimit": "Alterar limite de esquadria do ponto",
    "undo.pointClear": "Limpar os valores dos pontos",
    "tool.title": "Espessuras do traço: arraste as alças nas bordas dos pontos",
    "setting.handles": "Mostrar alças de espessura (ferramenta de espessura)",
    "menu.pointJoin": "Canto do ponto",
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
    "setting.outlineOnly": "Desenhar só o contorno",
    "setting.fillOpacity": "Opacidade do preenchimento",
    "setting.otherGlyphs": "Mostrar os traços nos outros glifos",
    "source.between": "Entre matrizes",
    "source.notAtSource":
      "Fora de uma matriz: a pré-visualização usa valores interpolados entre as matrizes. Vá até uma matriz para alterar os seus valores.",
    "source.sharedStyle":
      "Terminal e canto são iguais em todas as matrizes e ficam guardados na matriz predefinida, «{0}».",
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
    "field.left": "Esquerda",
    "field.right": "Direita",
    "point.sourceValue": "Valor da matriz",
    "points.title": "Pontos selecionados: {0}",
    "points.noneTitle": "Pontos",
    "points.none":
      "Selecione pontos de uma linha central para lhes dar uma espessura própria. Um ponto no meio sem espessura própria segue os pontos à sua volta.",
    "points.sharedJoin":
      "Os cantos dos pontos são iguais em todas as matrizes e são guardados na matriz predefinida, «{0}».",
    "points.clear": "Apagar os valores dos pontos",
    "undo.pointWidth": "Alterar espessura do ponto",
    "undo.pointJoin": "Alterar canto do ponto",
    "undo.pointMiterLimit": "Alterar limite de esquadria do ponto",
    "undo.pointClear": "Apagar os valores dos pontos",
    "tool.title": "Espessuras do traço: arraste as pegas nos limites dos pontos",
    "setting.handles": "Mostrar pegas de espessura (ferramenta de espessura)",
    "menu.pointJoin": "Canto do ponto",
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
    "setting.outlineOnly": "Рисовать только край",
    "setting.fillOpacity": "Непрозрачность заливки",
    "setting.otherGlyphs": "Показывать обводку на других глифах",
    "source.between": "Между мастерами",
    "source.notAtSource":
      "Не в позиции мастера: для просмотра значения интерполируются между мастерами. Перейдите к мастеру, чтобы изменить его значения.",
    "source.sharedStyle":
      "Концы и углы одинаковы во всех мастерах и сохраняются в мастере по умолчанию «{0}».",
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
    "field.left": "Слева",
    "field.right": "Справа",
    "point.sourceValue": "Значение мастера",
    "points.title": "Выбранные точки: {0}",
    "points.noneTitle": "Точки",
    "points.none":
      "Выберите точки средней линии, чтобы задать им собственную толщину. Точка в середине без собственной толщины следует за соседними точками.",
    "points.sharedJoin":
      "Углы точек одинаковы во всех мастерах и сохраняются в мастере по умолчанию «{0}».",
    "points.clear": "Очистить значения точек",
    "undo.pointWidth": "Изменение толщины точки",
    "undo.pointJoin": "Изменение угла точки",
    "undo.pointMiterLimit": "Изменение предела среза точки",
    "undo.pointClear": "Очистка значений точек",
    "tool.title": "Толщина обводки: перетаскивайте маркеры на краях точек",
    "setting.handles": "Показывать маркеры толщины (инструмент толщины)",
    "menu.pointJoin": "Угол точки",
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
