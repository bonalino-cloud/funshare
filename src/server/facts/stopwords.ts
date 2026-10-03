// Небольшие свои списки стоп-слов (ru + en), без зависимостей. Слова уже в нижнем
// регистре, «ё» заменена на «е». Список умышленно короткий: цель — отсечь служебные
// слова, а не построить полноценный морфологический анализ.

const RU = `
и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по
только ее мне было вот от меня еще нет о из ему теперь когда даже ну вдруг ли если
уже или ни быть был него до вас нибудь опять уж вам ведь там потом себя ничего ей
может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз
тоже себе под будет ж тогда кто этот того потому этого какой совсем ним здесь этом
один почти мой тем чтобы нее сейчас были куда зачем всех никогда можно при наконец
два об другой хоть после над больше тот через эти нас про всего них какая много
разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой
им более всегда конечно всю между это эта эти очень просто тоже моя мои мой наш наша
наши твой твоя ваш ваша они оно том там тут вот еще уже тебе нам вам себя свой свои
или либо итак потому поэтому который которая которые которое каждый весь всё
`;

const EN = `
the a an and or but if then else of to in on at by for with about against between into
through during before after above below from up down out off over under again further
once here there when where why how all any both each few more most other some such no
nor not only own same so than too very can will just don should now is are was were be
been being have has had having do does did doing i me my myself we our ours you your
yours he him his she her hers it its they them their theirs what which who whom this
that these those am would could its im ive dont cant lets us get got
`;

export const STOPWORDS: ReadonlySet<string> = new Set(`${RU} ${EN}`.split(/\s+/).filter(Boolean));
