# Trivia embebible

Widget de trivia en formato Web Component, pensado para insertarse en otros sitios sin generar conflictos de estilos. El componente usa Shadow DOM, por lo que su CSS queda encapsulado.

## Uso

```html
<trivia-widget src="./trivia-data.json"></trivia-widget>
<script src="./trivia-widget.js"></script>
```

Tambien se puede usar JSON inline:

```html
<trivia-widget>
  <script type="application/json">
    {
      "title": "Trivia demo",
      "questions": [
        {
          "question": "Pregunta de ejemplo",
          "options": ["Opcion 1", "Opcion 2", "Opcion 3", "Opcion 4"],
          "correctOption": 2,
          "explanation": "Detalle breve de la respuesta correcta."
        }
      ]
    }
  </script>
</trivia-widget>
<script src="./trivia-widget.js"></script>
```

## Estructura del JSON

- `title`: titulo de la trivia.
- `intro`: texto breve opcional.
- `questions`: array dinamico de preguntas.
- `question`: texto de la pregunta.
- `options`: array con exactamente 4 opciones.
- `correctOption`: numero de opcion correcta, de 1 a 4.
- `explanation`: explicacion breve que aparece despues de responder.

El boton para descartar opciones tiene 3 usos por trivia y solo puede usarse una vez por pregunta.

Cada pregunta inicia con un temporizador visual de 15 segundos. Si el tiempo llega a cero, la pregunta se marca como incorrecta y se muestra la explicacion en el mismo espacio donde estaba el texto de la pregunta.
